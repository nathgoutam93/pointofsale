import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentMode, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { signToken } from '../auth/token';
import type { SessionUser } from '../common/types';
import { toNumber, round2 } from '../common/numbers';
import { requireSessionBranchId, requireSessionRegisterId } from '../common/session';
import { branchSummarySelect, registerSelect } from '../common/selects';
import { SettingsService } from '../settings/settings.service';
import { BranchesService } from '../branches/branches.service';

@Injectable()
export class RegistersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly branches: BranchesService
  ) {}

  /** Holds a lock per branch until the transaction ends, so only one register can be opened at a time. */
  private async lockBranchRegister(tx: Prisma.TransactionClient, branchId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`register:${branchId}`}, 0))`;
  }

  private toRegisterDto(register: Prisma.RegisterSessionGetPayload<{ select: typeof registerSelect }>) {
    const optional = (value: Prisma.Decimal | null) => (value === null ? null : toNumber(value));
    return {
      id: register.id,
      branchId: register.branchId,
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
  async assertRegisterOpen(tx: Prisma.TransactionClient, session: SessionUser) {
    const registerId = requireSessionRegisterId(session);
    const rows = await tx.$queryRaw<Array<{ closedAt: Date | null }>>`
      SELECT "closedAt" FROM "RegisterSession" WHERE id = ${registerId} FOR SHARE`;
    if (rows.length === 0 || rows[0].closedAt !== null) {
      throw new BadRequestException('Register is closed. Open a register to continue.');
    }
  }

  async openRegister(session: SessionUser, branchId: string, openingBalance: number) {
    if (!Number.isFinite(openingBalance) || openingBalance < 0) {
      throw new BadRequestException('Opening balance must be 0 or more');
    }
    await this.settings.ensureBranchExists(branchId);
    await this.branches.ensureUserHasBranchAccess(session.userId, branchId);

    const register = await this.prisma.$transaction(async (tx) => {
      await this.lockBranchRegister(tx, branchId);
      const openRegister = await tx.registerSession.findFirst({
        where: { branchId, closedAt: null },
        select: { id: true }
      });
      if (openRegister) {
        throw new BadRequestException('This branch already has an open register. Close it before opening a new one.');
      }
      return tx.registerSession.create({
        data: {
          userId: session.userId,
          branchId,
          openingBalance
        }
      });
    });

    return {
      token: signToken({ userId: session.userId, role: session.role, branchId, registerId: register.id }),
      register: {
        id: register.id,
        branchId: register.branchId,
        openingBalance: toNumber(register.openingBalance),
        closingBalance: register.closingBalance ? toNumber(register.closingBalance) : null,
        openedAt: register.openedAt,
        closedAt: register.closedAt
      }
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

    const openRegisters = await this.prisma.registerSession.findMany({
      where: { branchId: { in: branchIds }, closedAt: null },
      select: registerSelect
    });

    const lastClosedRegisters = await this.prisma.registerSession.findMany({
      where: { branchId: { in: branchIds }, closedAt: { not: null } },
      orderBy: { closedAt: 'desc' },
      distinct: ['branchId'],
      select: registerSelect
    });

    const openByBranch = new Map(openRegisters.map((register) => [register.branchId, register]));
    const lastClosedByBranch = new Map(
      lastClosedRegisters.map((register) => [register.branchId, register])
    );

    const toDto = (register: Parameters<RegistersService['toRegisterDto']>[0] | undefined) =>
      register ? this.toRegisterDto(register) : null;

    return branchIds.map((branchId) => ({
      branchId,
      current: toDto(openByBranch.get(branchId)),
      lastClosed: toDto(lastClosedByBranch.get(branchId))
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
