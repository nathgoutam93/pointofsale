import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SupplierPaymentMode } from '@prisma/client';
import { assertRegisterOpen } from '../common/register-open';
import { AuditService } from '../common/audit.service';
import { round2, toNumber } from '../common/numbers';
import type { SessionUser } from '../common/types';
import { PrismaService } from '../prisma.service';
import { localDate } from '../reports/zoned-dates';
import { supplierLedger } from './supplier-ledger';

export type SupplierInput = {
  name?: string;
  gstin?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  paymentTermsDays?: number | null;
  isActive?: boolean;
};

export type SupplierPaymentInput = {
  branchId: string;
  amount: number;
  mode: SupplierPaymentMode;
  fromDrawer: boolean;
  reference?: string;
  note?: string;
};

const nameKeyOf = (name: string) => name.trim().toLowerCase();
const blankToNull = (value: string | null | undefined) => (value === undefined ? undefined : value?.trim() || null);

/** A day as YYYY-MM-DD. */
const isoDate = (date: { year: number; month: number; day: number }) =>
  `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;

/**
 * Suppliers and their accounts: what purchases owe them, less goods sent back and payments
 * made to them (see supplierLedger).
 */
@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  private async timeZone(client: Prisma.TransactionClient | PrismaService = this.prisma) {
    const settings = await client.businessSettings.findUnique({ where: { id: 'default' }, select: { timezone: true } });
    return settings?.timezone ?? 'Asia/Kolkata';
  }

  /** Today in the business's time zone (YYYY-MM-DD). */
  async today(client: Prisma.TransactionClient | PrismaService = this.prisma) {
    return isoDate(localDate(new Date(), await this.timeZone(client)));
  }

  /** The day a purchase counts from: the supplier invoice's date, else the day it was received. */
  purchaseDate(purchase: { supplierInvoiceDate: string | null; createdAt: Date }, timeZone: string) {
    return purchase.supplierInvoiceDate ?? isoDate(localDate(purchase.createdAt, timeZone));
  }

  /** The accounts of the given suppliers (all when none are given), by supplier id. */
  private async ledgers(supplierIds?: string[]) {
    const where = supplierIds ? { supplierId: { in: supplierIds } } : { supplierId: { not: null } };
    const [purchases, returns, payments, timeZone] = await Promise.all([
      this.prisma.purchase.findMany({
        where,
        select: { id: true, supplierId: true, purchaseNo: true, supplierInvoiceNo: true, supplierInvoiceDate: true, dueDate: true, grandTotal: true, createdAt: true, settledBeforeAccounts: true }
      }),
      this.prisma.purchaseReturn.findMany({ where, select: { id: true, supplierId: true, returnNo: true, purchaseId: true, totalAmount: true, createdAt: true } }),
      this.prisma.supplierPayment.findMany({
        where: supplierIds ? { supplierId: { in: supplierIds } } : {},
        select: { id: true, supplierId: true, amount: true, mode: true, reference: true, createdAt: true }
      }),
      this.timeZone()
    ]);
    const today = isoDate(localDate(new Date(), timeZone));
    const ids = new Set([...purchases, ...returns, ...payments].map((row) => row.supplierId).filter((id): id is string => !!id));
    return new Map(
      [...ids].map((id) => [
        id,
        supplierLedger({
          purchases: purchases
            .filter((row) => row.supplierId === id)
            .map((row) => ({ ...row, date: this.purchaseDate(row, timeZone), grandTotal: toNumber(row.grandTotal) })),
          returns: returns.filter((row) => row.supplierId === id).map((row) => ({ ...row, totalAmount: toNumber(row.totalAmount) })),
          payments: payments.filter((row) => row.supplierId === id).map((row) => ({ ...row, amount: toNumber(row.amount) })),
          today
        })
      ])
    );
  }

  private withBalance<T extends { id: string }>(supplier: T, ledgers: Map<string, ReturnType<typeof supplierLedger>>) {
    const ledger = ledgers.get(supplier.id);
    return { ...supplier, balance: ledger?.balance ?? 0, overdue: ledger?.overdue ?? 0 };
  }

  async list(includeInactive: boolean) {
    const [suppliers, ledgers] = await Promise.all([
      this.prisma.supplier.findMany({ where: includeInactive ? {} : { isActive: true }, orderBy: { name: 'asc' } }),
      this.ledgers()
    ]);
    return suppliers.map((supplier) => this.withBalance(supplier, ledgers));
  }

  private async assertNameFree(client: Prisma.TransactionClient | PrismaService, name: string, exceptId?: string) {
    const existing = await client.supplier.findUnique({ where: { nameKey: nameKeyOf(name) }, select: { id: true, name: true } });
    if (existing && existing.id !== exceptId) throw new BadRequestException(`There is already a supplier named ${existing.name}`);
  }

  async create(session: SessionUser, input: SupplierInput & { name: string }) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertNameFree(tx, input.name);
      const supplier = await tx.supplier.create({
        data: {
          name: input.name.trim(),
          nameKey: nameKeyOf(input.name),
          gstin: input.gstin?.trim().toUpperCase() || null,
          phone: blankToNull(input.phone) ?? null,
          email: blankToNull(input.email) ?? null,
          address: blankToNull(input.address) ?? null,
          paymentTermsDays: input.paymentTermsDays ?? null
        }
      });
      await this.audit.record(session, { action: 'SUPPLIER_ADDED', entityType: 'Supplier', entityId: supplier.id, summary: `Added supplier ${supplier.name}` }, tx);
      return { ...supplier, balance: 0, overdue: 0 };
    });
  }

  async update(session: SessionUser, id: string, input: SupplierInput) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await tx.supplier.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Supplier not found');
      if (input.name !== undefined) await this.assertNameFree(tx, input.name, id);
      const after = await tx.supplier.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim(), nameKey: nameKeyOf(input.name) } : {}),
          gstin: input.gstin === undefined ? undefined : input.gstin?.trim().toUpperCase() || null,
          phone: blankToNull(input.phone),
          email: blankToNull(input.email),
          address: blankToNull(input.address),
          paymentTermsDays: input.paymentTermsDays,
          isActive: input.isActive
        }
      });
      const changes = AuditService.changes(before, after, ['name', 'gstin', 'phone', 'email', 'address', 'paymentTermsDays', 'isActive']);
      if (Object.keys(changes).length > 0) {
        await this.audit.record(session, { action: 'SUPPLIER_UPDATED', entityType: 'Supplier', entityId: id, summary: `Changed supplier ${after.name}`, details: changes as Prisma.InputJsonValue }, tx);
      }
      return after;
    });
    return this.withBalance(updated, await this.ledgers([id]));
  }

  async account(id: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) throw new NotFoundException('Supplier not found');
    const ledger = (await this.ledgers([id])).get(id) ?? { balance: 0, overdue: 0, openBills: [], entries: [] };
    return { supplier: { ...supplier, balance: ledger.balance, overdue: ledger.overdue }, openBills: ledger.openBills, entries: ledger.entries };
  }

  /**
   * Records money paid to a supplier. Cash from the drawer must come from this user's open
   * register at the branch, and lowers the cash expected there at close.
   */
  async pay(session: SessionUser, id: string, input: SupplierPaymentInput) {
    return this.prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findUnique({ where: { id }, select: { id: true, name: true } });
      if (!supplier) throw new NotFoundException('Supplier not found');
      let registerSessionId: string | null = null;
      if (input.fromDrawer) {
        if (input.mode !== SupplierPaymentMode.CASH) throw new BadRequestException('Only cash comes from the drawer');
        if (session.branchId !== input.branchId || !session.registerId) {
          throw new BadRequestException('Open a register at this branch to pay from its drawer');
        }
        await assertRegisterOpen(tx, session);
        registerSessionId = session.registerId;
      }
      const user = await tx.user.findUnique({ where: { id: session.userId }, select: { username: true } });
      if (!user) throw new NotFoundException('User not found');
      const amount = round2(input.amount);
      const payment = await tx.supplierPayment.create({
        data: {
          supplierId: id,
          branchId: input.branchId,
          amount,
          mode: input.mode,
          reference: input.reference?.trim() || null,
          note: input.note?.trim() || null,
          registerSessionId,
          createdBy: session.userId,
          createdByName: user.username
        }
      });
      await this.audit.record(
        session,
        {
          action: 'SUPPLIER_PAID',
          entityType: 'Supplier',
          entityId: id,
          branchId: input.branchId,
          summary: `Paid ${supplier.name} ${amount.toFixed(2)} by ${input.mode.replace('_', ' ').toLowerCase()}${registerSessionId ? ' from the drawer' : ''}`,
          details: { paymentId: payment.id, amount, mode: input.mode, reference: payment.reference }
        },
        tx
      );
      return { ...payment, amount };
    });
  }

  /**
   * The supplier a purchase is made from: by id, else the one with that name (added when there
   * is none). A GSTIN given with the purchase fills in one the supplier lacks.
   */
  async resolveForPurchase(tx: Prisma.TransactionClient, input: { supplierId?: string; supplierName?: string; supplierGstin?: string | null }) {
    const gstin = input.supplierGstin?.trim().toUpperCase() || null;
    let supplier = input.supplierId
      ? await tx.supplier.findUnique({ where: { id: input.supplierId } })
      : await tx.supplier.findUnique({ where: { nameKey: nameKeyOf(input.supplierName ?? '') } });
    if (input.supplierId && !supplier) throw new NotFoundException('Supplier not found');
    if (!supplier) {
      const name = (input.supplierName ?? '').trim();
      if (!name) throw new BadRequestException('Choose a supplier');
      supplier = await tx.supplier.create({ data: { name, nameKey: nameKeyOf(name), gstin } });
    } else if (gstin && !supplier.gstin) {
      supplier = await tx.supplier.update({ where: { id: supplier.id }, data: { gstin } });
    }
    if (!supplier.isActive) throw new BadRequestException(`${supplier.name} is no longer used. Make the supplier active to buy from them.`);
    return supplier;
  }
}
