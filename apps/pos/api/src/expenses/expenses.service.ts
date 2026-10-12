import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CashMovementType, Prisma, SupplierPaymentMode } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { SessionUser } from '../common/types';
import { round2, toNumber } from '../common/numbers';
import { isFallback } from '../common/mode';
import { assertRegisterOpen } from '../common/register-open';
import { requireSessionRegisterId } from '../common/session';
import { AuditService } from '../common/audit.service';
import { RegistersService } from '../registers/registers.service';
import { SettingsService } from '../settings/settings.service';
import { businessToday } from '../stock/batch-stock';

export type ExpenseInput = {
  branchId: string;
  date?: string;
  category: string;
  amount: number;
  mode: SupplierPaymentMode;
  fromDrawer: boolean;
  reference?: string;
  note?: string;
};

const money = <T extends { amount: Prisma.Decimal }>(row: T) => ({ ...row, amount: toNumber(row.amount) });
const words = (mode: SupplierPaymentMode) => mode.replace('_', ' ').toLowerCase();

/** Cash put into or taken out of a drawer, and the business's expense book. The caller checks who may. */
@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registers: RegistersService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService
  ) {}

  /** A fallback counter's copy doesn't send these to the server, so they wait until it's back. */
  private assertNotFallback() {
    if (isFallback()) throw new BadRequestException("Record cash in or out and expenses when the server is back: this counter's copy doesn't send them");
  }

  /** Fails when more cash would leave the session's drawer than is expected to be in it. */
  private async assertDrawerHolds(tx: Prisma.TransactionClient, registerId: string, amount: number) {
    const register = await tx.registerSession.findUniqueOrThrow({ where: { id: registerId }, select: { openingBalance: true } });
    const { expectedCash } = await this.registers.registerCash(tx, registerId, toNumber(register.openingBalance));
    if (amount > expectedCash + 0.005) {
      throw new BadRequestException(`Only ${expectedCash.toFixed(2)} is expected in the drawer`);
    }
  }

  private async userName(tx: Prisma.TransactionClient, session: SessionUser) {
    const user = await tx.user.findUnique({ where: { id: session.userId }, select: { username: true } });
    if (!user) throw new NotFoundException('User not found');
    return user.username;
  }

  async cashMovement(session: SessionUser, input: { type: CashMovementType; amount: number; reason: string; note?: string }) {
    this.assertNotFallback();
    const registerId = requireSessionRegisterId(session);
    return this.prisma.$transaction(async (tx) => {
      await assertRegisterOpen(tx, session);
      const amount = round2(input.amount);
      if (input.type === CashMovementType.CASH_OUT) await this.assertDrawerHolds(tx, registerId, amount);
      const register = await tx.registerSession.findUniqueOrThrow({ where: { id: registerId }, select: { branchId: true } });
      const movement = await tx.cashMovement.create({
        data: {
          branchId: register.branchId,
          registerSessionId: registerId,
          type: input.type,
          amount,
          reason: input.reason.trim(),
          note: input.note?.trim() || null,
          createdBy: session.userId,
          createdByName: await this.userName(tx, session)
        }
      });
      await this.audit.record(
        session,
        {
          action: input.type === CashMovementType.CASH_IN ? 'CASH_IN' : 'CASH_OUT',
          entityType: 'RegisterSession',
          entityId: registerId,
          branchId: register.branchId,
          summary: `${input.type === CashMovementType.CASH_IN ? 'Cash put in' : 'Cash taken out'}: ${amount.toFixed(2)} (${movement.reason})`,
          details: { movementId: movement.id, amount, reason: movement.reason, note: movement.note }
        },
        tx
      );
      return money(movement);
    });
  }

  /** The session's register: cash moved in or out, and expenses paid from its drawer, newest first. */
  async registerEntries(session: SessionUser) {
    const registerId = requireSessionRegisterId(session);
    const [movements, expenses] = await Promise.all([
      this.prisma.cashMovement.findMany({ where: { registerSessionId: registerId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.expense.findMany({ where: { registerSessionId: registerId }, orderBy: { createdAt: 'desc' } })
    ]);
    return { movements: movements.map(money), expenses: expenses.map(money) };
  }

  async create(session: SessionUser, input: ExpenseInput) {
    this.assertNotFallback();
    await this.settings.ensureBranchExists(input.branchId);
    return this.prisma.$transaction(async (tx) => {
      const today = await businessToday(tx);
      if (input.date && input.date > today) throw new BadRequestException('The expense date is in the future');
      const amount = round2(input.amount);
      let registerSessionId: string | null = null;
      if (input.fromDrawer) {
        if (input.mode !== SupplierPaymentMode.CASH) throw new BadRequestException('Only cash comes from the drawer');
        if (session.branchId !== input.branchId || !session.registerId) {
          throw new BadRequestException('Open a register at this branch to pay from its drawer');
        }
        if (input.date && input.date !== today) throw new BadRequestException("Cash from the drawer is paid today: leave the date as today's");
        await assertRegisterOpen(tx, session);
        registerSessionId = session.registerId;
        await this.assertDrawerHolds(tx, registerSessionId, amount);
      }
      const expense = await tx.expense.create({
        data: {
          branchId: input.branchId,
          date: input.date ?? today,
          category: input.category.trim(),
          amount,
          mode: input.mode,
          reference: input.reference?.trim() || null,
          note: input.note?.trim() || null,
          registerSessionId,
          createdBy: session.userId,
          createdByName: await this.userName(tx, session)
        }
      });
      await this.audit.record(
        session,
        {
          action: 'EXPENSE_RECORDED',
          entityType: 'Expense',
          entityId: expense.id,
          branchId: input.branchId,
          summary: `Expense: ${expense.category} ${amount.toFixed(2)} by ${words(input.mode)}${registerSessionId ? ' from the drawer' : ''}`,
          details: { amount, category: expense.category, mode: input.mode, date: expense.date, reference: expense.reference }
        },
        tx
      );
      return money(expense);
    });
  }

  /** A branch's expenses in a period (by the day paid), newest first, with totals by category. */
  async list(branchId: string, from: string, to: string) {
    await this.settings.ensureBranchExists(branchId);
    if (from > to) throw new BadRequestException('The period ends before it starts');
    const expenses = (
      await this.prisma.expense.findMany({
        where: { branchId, date: { gte: from, lte: to } },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: 2000
      })
    ).map(money);
    const byCategory = new Map<string, { category: string; count: number; total: number }>();
    for (const expense of expenses) {
      const entry = byCategory.get(expense.category) ?? { category: expense.category, count: 0, total: 0 };
      entry.count += 1;
      entry.total = round2(entry.total + expense.amount);
      byCategory.set(expense.category, entry);
    }
    return {
      expenses,
      byCategory: [...byCategory.values()].sort((a, b) => b.total - a.total),
      total: round2(expenses.reduce((sum, expense) => sum + expense.amount, 0))
    };
  }

  /** Removes an expense entered by mistake: one from a drawer only while its register is open. */
  async remove(session: SessionUser, id: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.findUnique({ where: { id } });
      if (!expense) throw new NotFoundException('Expense not found');
      if (expense.registerSessionId) {
        const register = await tx.$queryRaw<Array<{ closedAt: Date | null }>>`
          SELECT "closedAt" FROM "RegisterSession" WHERE id = ${expense.registerSessionId} FOR SHARE`;
        if (register[0]?.closedAt) throw new BadRequestException("Its register is closed: the cash count can't change now");
      }
      await tx.expense.delete({ where: { id } });
      await this.audit.record(
        session,
        {
          action: 'EXPENSE_REMOVED',
          entityType: 'Expense',
          entityId: id,
          branchId: expense.branchId,
          summary: `Expense removed: ${expense.category} ${toNumber(expense.amount).toFixed(2)} of ${expense.date} (${reason.trim()})`,
          details: { amount: toNumber(expense.amount), category: expense.category, date: expense.date, reason: reason.trim() }
        },
        tx
      );
      return { id };
    });
  }

  /** The branch an expense belongs to, for the access check. */
  async branchOf(id: string) {
    const expense = await this.prisma.expense.findUnique({ where: { id }, select: { branchId: true } });
    if (!expense) throw new NotFoundException('Expense not found');
    return expense.branchId;
  }
}
