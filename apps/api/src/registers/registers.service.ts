import { isFallback, isOffline } from '../common/mode';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CashMovementType, PaymentMode, Prisma, WalletTxnType } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { signToken } from '../auth/token';
import type { SessionUser } from '../common/types';
import { toNumber, round2 } from '../common/numbers';
import { requireSessionBranchId, requireSessionRegisterId } from '../common/session';
import { branchSummarySelect, registerSelect } from '../common/selects';
import { SettingsService } from '../settings/settings.service';
import { lockBranchRegisters } from '../common/counters';
import { requireAdmin } from '../common/request-session';
import { AuditService } from '../common/audit.service';
import { assertRegisterOpen } from '../common/register-open';
import { BranchesService } from '../branches/branches.service';

@Injectable()
export class RegistersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly branches: BranchesService,
    private readonly audit: AuditService
  ) {}

  private toRegisterDto(register: Prisma.RegisterSessionGetPayload<{ select: typeof registerSelect }>) {
    const optional = (value: Prisma.Decimal | null) => (value === null ? null : toNumber(value));
    return {
      id: register.id,
      branchId: register.branchId,
      counterId: register.counterId,
      counterName: register.counter.name,
      openedBy: register.user.username,
      openingBalance: toNumber(register.openingBalance),
      closingBalance: optional(register.closingBalance),
      expectedCash: optional(register.expectedCash),
      cashDifference: optional(register.cashDifference),
      openedAt: register.openedAt,
      closedAt: register.closedAt
    };
  }

  /**
   * Cash that should be in a register's drawer: the opening balance plus cash payments and
   * cash wallet top-ups taken on it and cash put in, minus cash refunds given, cash paid to
   * suppliers and for expenses from it and cash taken out. Card, UPI and wallet
   * don't touch the drawer; card and UPI takings (payments and top-ups) are reported for
   * checking against their settlements.
   */
  async registerCash(client: Prisma.TransactionClient | PrismaService, registerId: string, openingBalance: number) {
    const fallback = isFallback();
    const [baseline, takenByMode, topupsByMode, cashRefunded, paidOut, movements, expenses] = await Promise.all([
      fallback ? client.fallbackRegisterBalance.findUnique({ where: { registerId } }) : null,
      client.payment.groupBy({
        by: ['mode'],
        where: { registerSessionId: registerId },
        _sum: { amount: true }
      }),
      client.walletTxn.groupBy({
        by: ['paymentMode'],
        where: { registerSessionId: registerId, type: WalletTxnType.TOPUP },
        _sum: { amount: true }
      }),
      // A fallback copy's refunds made online are in its baseline already (FallbackCopiedDocument).
      fallback
        ? client.$queryRaw<Array<{ total: Prisma.Decimal | null }>>`
            SELECT SUM(r."refundAmount") AS total FROM "ReturnInvoice" r
            WHERE r."registerSessionId" = ${registerId} AND r."refundMode" = 'CASH'
              AND NOT EXISTS (SELECT 1 FROM "FallbackCopiedDocument" c WHERE c."id" = r."id")`.then(([row]) => row?.total ?? null)
        : client.returnInvoice
            .aggregate({ where: { registerSessionId: registerId, refundMode: PaymentMode.CASH }, _sum: { refundAmount: true } })
            .then((sum) => sum._sum.refundAmount),
      client.supplierPayment.aggregate({ where: { registerSessionId: registerId }, _sum: { amount: true } }),
      client.cashMovement.groupBy({ by: ['type'], where: { registerSessionId: registerId }, _sum: { amount: true } }),
      client.expense.aggregate({ where: { registerSessionId: registerId }, _sum: { amount: true } })
    ]);
    const moved = (type: CashMovementType) => round2(toNumber(movements.find((row) => row.type === type)?._sum.amount));
    const topups = (mode: PaymentMode) => round2(toNumber(topupsByMode.find((row) => row.paymentMode === mode)?._sum.amount));
    const taken = (mode: PaymentMode) =>
      round2(toNumber(takenByMode.find((row) => row.mode === mode)?._sum.amount) + (mode === PaymentMode.CASH ? 0 : topups(mode)));
    const cashSales = round2(taken(PaymentMode.CASH) + toNumber(baseline?.cashSales));
    const cashTopups = round2(topups(PaymentMode.CASH) + toNumber(baseline?.cashTopups));
    const cashRefunds = round2(toNumber(cashRefunded) + toNumber(baseline?.cashRefunds));
    const cashPaidOut = round2(toNumber(paidOut._sum.amount) + toNumber(baseline?.cashPaidOut));
    const cashIn = round2(moved(CashMovementType.CASH_IN) + toNumber(baseline?.cashIn));
    const cashTakenOut = round2(moved(CashMovementType.CASH_OUT) + toNumber(baseline?.cashOut));
    const cashExpenses = round2(toNumber(expenses._sum.amount) + toNumber(baseline?.cashExpenses));
    return {
      cashSales,
      cashTopups,
      cashRefunds,
      cashPaidOut,
      cashIn,
      cashOut: cashTakenOut,
      cashExpenses,
      expectedCash: round2(openingBalance + cashSales + cashTopups + cashIn - cashRefunds - cashPaidOut - cashTakenOut - cashExpenses),
      cardSales: round2(taken(PaymentMode.CARD) + toNumber(baseline?.cardSales)),
      upiSales: round2(taken(PaymentMode.UPI) + toNumber(baseline?.upiSales))
    };
  }

  /** Fails unless the session's register is still open; returns the counter it runs on (see assertRegisterOpen). */
  assertRegisterOpen(tx: Prisma.TransactionClient, session: SessionUser) {
    return assertRegisterOpen(tx, session);
  }

  /**
   * Opens a register on one of the branch's counters. Each counter holds one open register,
   * and a user runs one counter per branch at a time; other counters in the branch can be
   * open by other cashiers at the same time.
   */
  /** `deviceId`: the computer asking (desktop app); a fallback counter opens only on its own. */
  async openRegister(session: SessionUser, branchId: string, openingBalance: number, counterId?: string, deviceId?: string) {
    if (!Number.isFinite(openingBalance) || openingBalance < 0) {
      throw new BadRequestException('Opening balance must be 0 or more');
    }
    await this.settings.ensureBranchExists(branchId);
    await this.branches.ensureUserHasBranchAccess(session.userId, branchId);

    const register = await this.prisma.$transaction(async (tx) => {
      await lockBranchRegisters(tx, branchId);

      let counter: { id: string; name: string; isActive: boolean; fallbackDeviceId: string | null } | null;
      if (counterId) {
        counter = await tx.counter.findFirst({
          where: { id: counterId, branchId },
          select: { id: true, name: true, isActive: true, fallbackDeviceId: true }
        });
        if (!counter) {
          throw new BadRequestException('Counter not found in this branch');
        }
        if (!counter.isActive) {
          throw new BadRequestException(`${counter.name} is inactive`);
        }
      } else {
        // Without a counter the choice must be unambiguous.
        const active = await tx.counter.findMany({
          where: { branchId, isActive: true },
          select: { id: true, name: true, isActive: true, fallbackDeviceId: true },
          take: 2
        });
        if (active.length !== 1) {
          throw new BadRequestException(active.length === 0 ? 'This branch has no active counter' : 'Choose a counter');
        }
        counter = active[0];
      }

      // Its invoice series is issued only on its own computer, online or working offline as the
      // fallback counter. (In an offline install restored from an online export it means nothing.)
      if (counter.fallbackDeviceId && counter.fallbackDeviceId !== deviceId && (!isOffline() || isFallback())) {
        throw new BadRequestException(
          `${counter.name} is the branch's fallback counter: it opens only on its own computer. Choose another counter.`
        );
      }

      const mine = await tx.registerSession.findFirst({
        where: { branchId, userId: session.userId, closedAt: null },
        select: { counter: { select: { name: true } } }
      });
      if (mine) {
        throw new BadRequestException(`You already have ${mine.counter.name} open in this branch. Close it before opening another.`);
      }
      const taken = await tx.registerSession.findFirst({
        where: { counterId: counter.id, closedAt: null },
        select: { user: { select: { username: true } } }
      });
      if (taken) {
        throw new BadRequestException(`${counter.name} is already open (by ${taken.user.username}). Choose another counter.`);
      }

      return tx.registerSession.create({
        data: {
          userId: session.userId,
          branchId,
          counterId: counter.id,
          openingBalance
        },
        select: registerSelect
      });
    });

    return {
      token: signToken({ userId: session.userId, role: session.role, branchId, registerId: register.id }),
      register: this.toRegisterDto(register)
    };
  }

  async getCurrentRegister(session: SessionUser) {
    if (!session.registerId) {
      return null;
    }
    const register = await this.prisma.registerSession.findFirst({
      where: { id: session.registerId, userId: session.userId, closedAt: null },
      select: registerSelect
    });
    if (!register) {
      return null;
    }
    const dto = this.toRegisterDto(register);
    return { ...dto, ...(await this.registerCash(this.prisma, register.id, dto.openingBalance)) };
  }

  async getRegisterSummaries(session: SessionUser) {
    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
      include: {
        branchAccesses: {
          include: { branch: { select: branchSummarySelect } },
          orderBy: { createdAt: 'asc' }
        }
      }
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const branchIds = user.branchAccesses.map((access) => access.branch.id);
    if (branchIds.length === 0) {
      return [];
    }

    const counters = await this.prisma.counter.findMany({
      where: { branchId: { in: branchIds }, isActive: true },
      orderBy: { number: 'asc' },
      select: { id: true, branchId: true, number: true, name: true, isActive: true, fallbackDeviceId: true }
    });
    const counterIds = counters.map((counter) => counter.id);

    const openRegisters = await this.prisma.registerSession.findMany({
      where: { counterId: { in: counterIds }, closedAt: null },
      select: registerSelect
    });
    const lastClosedRegisters = await this.prisma.registerSession.findMany({
      where: { counterId: { in: counterIds }, closedAt: { not: null } },
      orderBy: { closedAt: 'desc' },
      distinct: ['counterId'],
      select: registerSelect
    });

    const openByCounter = new Map(openRegisters.map((register) => [register.counterId, register]));
    const lastClosedByCounter = new Map(lastClosedRegisters.map((register) => [register.counterId, register]));

    const toDto = (register: Parameters<RegistersService['toRegisterDto']>[0] | undefined) =>
      register ? this.toRegisterDto(register) : null;

    return branchIds.map((branchId) => ({
      branchId,
      counters: counters
        .filter((counter) => counter.branchId === branchId)
        .map((counter) => ({
          counter,
          current: toDto(openByCounter.get(counter.id)),
          lastClosed: toDto(lastClosedByCounter.get(counter.id))
        }))
    }));
  }

  async closeRegister(session: SessionUser, closingBalance: number) {
    if (!Number.isFinite(closingBalance) || closingBalance < 0) {
      throw new BadRequestException('Closing balance must be 0 or more');
    }
    const registerId = requireSessionRegisterId(session);
    const branchId = requireSessionBranchId(session);
    const result = await this.closeOpenRegister({ id: registerId, userId: session.userId, branchId }, closingBalance);
    return {
      token: signToken({ userId: session.userId, role: session.role }),
      register: result
    };
  }

  /**
   * An admin closes a register someone else left open, at a branch they manage. The cash may be
   * counted (closingBalance) or not (null: the expected cash is still worked out). Its user's
   * session ends with it.
   */
  async closeRegisterFor(session: SessionUser, registerId: string, closingBalance: number | null) {
    requireAdmin(session);
    if (closingBalance !== null && (!Number.isFinite(closingBalance) || closingBalance < 0)) {
      throw new BadRequestException('Closing balance must be 0 or more');
    }
    const register = await this.prisma.registerSession.findUnique({ where: { id: registerId }, select: { branchId: true } });
    if (!register) throw new NotFoundException('Open register not found');
    await this.branches.ensureUserHasBranchAccess(session.userId, register.branchId);
    const closed = await this.closeOpenRegister({ id: registerId }, closingBalance);
    await this.audit.record(session, {
      action: 'REGISTER_CLOSED_FOR',
      entityType: 'RegisterSession',
      entityId: registerId,
      branchId: register.branchId,
      summary: `Closed ${closed.counterName}, opened by ${closed.openedBy}: ${closingBalance === null ? 'cash not counted' : `counted ${closingBalance.toFixed(2)}`} (${closed.expectedCash?.toFixed(2) ?? '0.00'} expected)`,
      details: { expectedCash: closed.expectedCash, closingBalance, cashDifference: closed.cashDifference }
    });
    return closed;
  }

  /** Closes the open register matching `where`, recording the cash expected and, when counted, the difference. */
  private async closeOpenRegister(where: { id: string; userId?: string; branchId?: string }, closingBalance: number | null) {
    return this.prisma.$transaction(async (tx) => {
      // Lock the register so a sale or refund can't land between counting and closing.
      await tx.$queryRaw`SELECT id FROM "RegisterSession" WHERE id = ${where.id} FOR UPDATE`;
      const register = await tx.registerSession.findFirst({
        where: { ...where, closedAt: null },
        select: { id: true, openingBalance: true }
      });
      if (!register) {
        throw new NotFoundException('Open register not found');
      }
      const cash = await this.registerCash(tx, register.id, toNumber(register.openingBalance));
      const updated = await tx.registerSession.update({
        where: { id: register.id },
        data: {
          closingBalance,
          expectedCash: cash.expectedCash,
          cashDifference: closingBalance === null ? null : round2(closingBalance - cash.expectedCash),
          closedAt: new Date()
        },
        select: registerSelect
      });
      return {
        ...this.toRegisterDto(updated),
        cashSales: cash.cashSales,
        cashTopups: cash.cashTopups,
        cashRefunds: cash.cashRefunds,
        cashPaidOut: cash.cashPaidOut,
        cashIn: cash.cashIn,
        cashOut: cash.cashOut,
        cashExpenses: cash.cashExpenses,
        cardSales: cash.cardSales,
        upiSales: cash.upiSales
      };
    });
  }
}
