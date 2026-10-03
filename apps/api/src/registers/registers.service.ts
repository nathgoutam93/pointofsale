import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentMode, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { signToken } from '../auth/token';
import type { SessionUser } from '../common/types';
import { toNumber, round2 } from '../common/numbers';
import { requireSessionBranchId, requireSessionRegisterId } from '../common/session';
import { branchSummarySelect, registerSelect } from '../common/selects';
import { SettingsService } from '../settings/settings.service';
import { lockBranchRegisters } from '../common/counters';
import { BranchesService } from '../branches/branches.service';

@Injectable()
export class RegistersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly branches: BranchesService
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
   * Cash that should be in a register's drawer: the opening balance plus cash payments
   * taken on it, minus cash refunds given from it. Card and wallet don't touch the drawer.
   */
  private async registerCash(client: Prisma.TransactionClient | PrismaService, registerId: string, openingBalance: number) {
    const [cashIn, cashOut] = await Promise.all([
      client.payment.aggregate({
        where: { registerSessionId: registerId, mode: PaymentMode.CASH },
        _sum: { amount: true }
      }),
      client.returnInvoice.aggregate({
        where: { registerSessionId: registerId, refundMode: PaymentMode.CASH },
        _sum: { totalAmount: true }
      })
    ]);
    const cashSales = round2(toNumber(cashIn._sum.amount));
    const cashRefunds = round2(toNumber(cashOut._sum.totalAmount));
    return { cashSales, cashRefunds, expectedCash: round2(openingBalance + cashSales - cashRefunds) };
  }

  /**
   * Money moving through a register must land before it closes: share-lock the register
   * row (close takes it exclusively) and check it is still open.
   */
  /** Fails unless the session's register is still open; returns the counter it runs on. */
  async assertRegisterOpen(tx: Prisma.TransactionClient, session: SessionUser) {
    const registerId = requireSessionRegisterId(session);
    const rows = await tx.$queryRaw<Array<{ closedAt: Date | null; counterId: string }>>`
      SELECT "closedAt", "counterId" FROM "RegisterSession" WHERE id = ${registerId} FOR SHARE`;
    if (rows.length === 0 || rows[0].closedAt !== null) {
      throw new BadRequestException('Register is closed. Open a register to continue.');
    }
    return { counterId: rows[0].counterId };
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

      // Its invoice series is issued only on its own computer, online or not.
      if (counter.fallbackDeviceId && counter.fallbackDeviceId !== deviceId) {
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
    const result = await this.prisma.$transaction(async (tx) => {
      // Lock the register so a sale or refund can't land between counting and closing.
      await tx.$queryRaw`SELECT id FROM "RegisterSession" WHERE id = ${registerId} FOR UPDATE`;
      const register = await tx.registerSession.findFirst({
        where: { id: registerId, userId: session.userId, branchId, closedAt: null },
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
          cashDifference: round2(closingBalance - cash.expectedCash),
          closedAt: new Date()
        },
        select: registerSelect
      });
      return { ...this.toRegisterDto(updated), cashSales: cash.cashSales, cashRefunds: cash.cashRefunds };
    });

    return {
      token: signToken({ userId: session.userId, role: session.role }),
      register: result
    };
  }
}
