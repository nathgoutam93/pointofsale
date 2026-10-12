import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CREDIT_LIMIT_EXCEEDED, invoiceDue } from '@pos/contracts';
import { CustomerScope, InvoiceStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { round2, toNumber } from '../common/numbers';
import type { SessionUser } from '../common/types';
import { Mailer } from '../mail/mailer';
import { localDate, startOfLocalDay } from '../reports/zoned-dates';
import { SettingsService } from '../settings/settings.service';
import { CustomersService } from './customers.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The bill fields what is owed on it comes from. */
const owedSelect = {
  id: true,
  invoiceNo: true,
  customerId: true,
  createdAt: true,
  dueDate: true,
  grandTotal: true,
  paidTotal: true,
  creditedTotal: true
} satisfies Prisma.SaleInvoiceSelect;
type OwedBill = Prisma.SaleInvoiceGetPayload<{ select: typeof owedSelect }>;

/** Bills that may still have something owed on them: unpaid (DRAFT) or part paid. */
const unpaidBills = { status: { in: [InvoiceStatus.DRAFT, InvoiceStatus.PARTIALLY_SETTLED] } } satisfies Prisma.SaleInvoiceWhereInput;

const dueOn = (bill: OwedBill) =>
  invoiceDue({ grandTotal: toNumber(bill.grandTotal), paidTotal: toNumber(bill.paidTotal), creditedTotal: toNumber(bill.creditedTotal) });

type Buckets = { days0to30: number; days31to60: number; days61to90: number; over90: number; total: number };
const emptyBuckets = (): Buckets => ({ days0to30: 0, days31to60: 0, days61to90: 0, over90: 0, total: 0 });

const inr = (amount: number) => `Rs ${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The calendar date (YYYY-MM-DD) as numbers. */
function parseDate(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return { year, month, day };
}

/**
 * Money customers owe on credit bills: their credit limits, when bills fall due, statements
 * and ageing. A bill is owed until paid (grandTotal − paidTotal − creditedTotal); it is
 * overdue once its due date (the sale's date plus the customer's payment terms) has passed.
 * Customers owe the business, so their bills at every branch count.
 */
@Injectable()
export class ReceivablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly customers: CustomersService,
    private readonly mailer: Mailer
  ) {}

  /** When a bill made now falls due: the start of the day `days` days after today, in `timeZone`. */
  dueDateFor(createdAt: Date, paymentTermsDays: number | null, timeZone: string) {
    if (paymentTermsDays === null) return null;
    const { year, month, day } = localDate(createdAt, timeZone);
    return startOfLocalDay(year, month, day + paymentTermsDays, timeZone);
  }

  /** The start of today in `timeZone`: a bill due before it is overdue. */
  private startOfToday(timeZone: string, now = new Date()) {
    const { year, month, day } = localDate(now, timeZone);
    return startOfLocalDay(year, month, day, timeZone);
  }

  private async outstanding(customerId: string, tx?: Prisma.TransactionClient) {
    const bills = await (tx ?? this.prisma).saleInvoice.findMany({ where: { customerId, ...unpaidBills }, select: owedSelect });
    return round2(bills.reduce((sum, bill) => sum + dueOn(bill), 0) + (await this.owedAtCopy(customerId, tx)));
  }

  /**
   * A fallback counter's copy has no unpaid bills, only what each customer owed when it was
   * made (FallbackBalance); offline, that counts as owed too. Always 0 on the server.
   */
  private async owedAtCopy(customerId: string, tx?: Prisma.TransactionClient) {
    const row = await (tx ?? this.prisma).fallbackBalance.findUnique({ where: { customerId }, select: { owed: true } });
    return toNumber(row?.owed);
  }

  /**
   * After a credit sale is made (inside its transaction): a cashier may not take a customer
   * past their credit limit; an admin may. The customer's row is locked, so two tills can't
   * both use the last of the room.
   */
  async assertWithinCreditLimit(tx: Prisma.TransactionClient, session: SessionUser, customerId: string) {
    const [customer] = await tx.$queryRaw<Array<{ name: string; creditLimit: Prisma.Decimal | null }>>`
      SELECT "name", "creditLimit" FROM "Customer" WHERE "id" = ${customerId} FOR UPDATE`;
    if (!customer || customer.creditLimit === null || session.role === UserRole.ADMIN) return;
    const limit = toNumber(customer.creditLimit);
    const owed = await this.outstanding(customerId, tx);
    if (owed > limit + 0.005) {
      throw new BadRequestException({
        statusCode: 400,
        code: CREDIT_LIMIT_EXCEEDED,
        message: `${customer.name} would owe ${inr(owed)}, over their credit limit of ${inr(limit)}. Take more payment now, or ask an admin.`
      });
    }
  }

  /** The customer, if `branchId` may use them (see CustomersService.customerUsableAt). */
  private async usableCustomer(branchId: string, customerId: string) {
    const scope = await this.settings.getCustomerScope();
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer || !this.customers.customerUsableAt(customer, branchId, scope)) {
      throw new NotFoundException('Customer not found');
    }
    return customer;
  }

  async account(branchId: string, customerId: string) {
    const customer = await this.usableCustomer(branchId, customerId);
    const { timezone } = await this.settings.ensureBusinessSettings();
    const today = this.startOfToday(timezone);
    const bills = (await this.prisma.saleInvoice.findMany({ where: { customerId, ...unpaidBills }, select: owedSelect })).filter((bill) => dueOn(bill) > 0);
    const overdueBills = bills.filter((bill) => bill.dueDate && bill.dueDate < today);
    const outstanding = round2(bills.reduce((sum, bill) => sum + dueOn(bill), 0) + (await this.owedAtCopy(customerId)));
    const creditLimit = customer.creditLimit === null ? null : toNumber(customer.creditLimit);
    const oldestDue = overdueBills.reduce<Date | null>((oldest, bill) => (!oldest || bill.dueDate! < oldest ? bill.dueDate : oldest), null);
    return {
      customerId,
      creditLimit,
      paymentTermsDays: customer.paymentTermsDays,
      outstanding,
      available: creditLimit === null ? null : round2(Math.max(0, creditLimit - outstanding)),
      overdue: round2(overdueBills.reduce((sum, bill) => sum + dueOn(bill), 0)),
      overdueBills: overdueBills.length,
      oldestDueDate: oldestDue?.toISOString() ?? null
    };
  }

  /** What is owed on `bills` now, by days since each bill (in `timeZone`), and how much is overdue. */
  private age(bills: OwedBill[], timeZone: string, now = new Date()) {
    const buckets = emptyBuckets();
    let overdue = 0;
    const today = localDate(now, timeZone);
    const todayUtc = Date.UTC(today.year, today.month - 1, today.day);
    const startOfToday = this.startOfToday(timeZone, now);
    for (const bill of bills) {
      const due = dueOn(bill);
      if (due <= 0) continue;
      const made = localDate(bill.createdAt, timeZone);
      const days = Math.round((todayUtc - Date.UTC(made.year, made.month - 1, made.day)) / DAY_MS);
      const bucket: keyof Buckets = days <= 30 ? 'days0to30' : days <= 60 ? 'days31to60' : days <= 90 ? 'days61to90' : 'over90';
      buckets[bucket] = round2(buckets[bucket] + due);
      buckets.total = round2(buckets.total + due);
      if (bill.dueDate && bill.dueDate < startOfToday) overdue = round2(overdue + due);
    }
    return { buckets, overdue };
  }

  /** Everyone a branch may sell to who owes something, by the age of what they owe; most owed first. */
  async ageing(branchId: string) {
    const { timezone, customerScope } = await this.settings.ensureBusinessSettings();
    const customerWhere: Prisma.CustomerWhereInput =
      customerScope === CustomerScope.SHARED ? { isWalkIn: false } : { branchId, isWalkIn: false };
    const bills = await this.prisma.saleInvoice.findMany({ where: { ...unpaidBills, customer: customerWhere }, select: owedSelect });
    const byCustomer = new Map<string, OwedBill[]>();
    for (const bill of bills) byCustomer.set(bill.customerId, [...(byCustomer.get(bill.customerId) ?? []), bill]);
    const customers = await this.prisma.customer.findMany({
      where: { id: { in: [...byCustomer.keys()] } },
      select: { id: true, code: true, name: true, phone: true, creditLimit: true }
    });
    const totals = { ...emptyBuckets(), overdue: 0 };
    const rows = customers
      .map((customer) => {
        const { buckets, overdue } = this.age(byCustomer.get(customer.id) ?? [], timezone);
        return {
          customerId: customer.id,
          code: customer.code,
          name: customer.name,
          phone: customer.phone,
          creditLimit: customer.creditLimit === null ? null : toNumber(customer.creditLimit),
          ...buckets,
          overdue
        };
      })
      .filter((row) => row.total > 0)
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    for (const row of rows) {
      for (const key of ['days0to30', 'days31to60', 'days61to90', 'over90', 'total', 'overdue'] as const) totals[key] = round2(totals[key] + row[key]);
    }
    return { timezone, rows, totals };
  }

  /**
   * Bills (debit), and payments and returns that took something off what was owed (credit),
   * between `from` and `to` (calendar dates in the business's time zone), with the balance
   * owed before them and after each. A payment's extra that went into the wallet isn't on the
   * account, nor is a return's refund (only what it took off the bill).
   */
  async statement(branchId: string, customerId: string, from: string, to: string) {
    if (from > to) throw new BadRequestException('The start date must be on or before the end date');
    const customer = await this.usableCustomer(branchId, customerId);
    const { timezone } = await this.settings.ensureBusinessSettings();
    const start = parseDate(from);
    const end = parseDate(to);
    const periodStart = startOfLocalDay(start.year, start.month, start.day, timezone);
    const periodEnd = startOfLocalDay(end.year, end.month, end.day + 1, timezone);

    const bills = await this.prisma.saleInvoice.findMany({
      where: { customerId, status: { not: InvoiceStatus.CANCELLED } },
      select: {
        ...owedSelect,
        reference: true,
        receipts: { select: { receiptNo: true, amount: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
        returns: { select: { returnNo: true, dueAdjusted: true, createdAt: true } }
      },
      orderBy: { createdAt: 'asc' }
    });

    type Entry = { date: Date; kind: 'BILL' | 'PAYMENT' | 'RETURN'; reference: string; detail: string | null; debit: number; credit: number };
    const all: Entry[] = [];
    for (const bill of bills) {
      all.push({ date: bill.createdAt, kind: 'BILL', reference: bill.invoiceNo, detail: bill.reference ? `Ref ${bill.reference}` : null, debit: toNumber(bill.grandTotal), credit: 0 });
      // What each payment took off the bill: up to what was paid in all (the rest went to the wallet).
      let unapplied = toNumber(bill.paidTotal);
      for (const receipt of bill.receipts) {
        const amount = toNumber(receipt.amount);
        const applied = round2(Math.min(amount, Math.max(0, unapplied)));
        unapplied = round2(unapplied - applied);
        if (applied <= 0) continue;
        const extra = round2(amount - applied);
        all.push({
          date: receipt.createdAt,
          kind: 'PAYMENT',
          reference: receipt.receiptNo,
          detail: `For ${bill.invoiceNo}${extra > 0 ? ` (${inr(extra)} more to wallet)` : ''}`,
          debit: 0,
          credit: applied
        });
      }
      for (const ret of bill.returns) {
        const adjusted = toNumber(ret.dueAdjusted);
        if (adjusted > 0) all.push({ date: ret.createdAt, kind: 'RETURN', reference: ret.returnNo, detail: `Goods returned on ${bill.invoiceNo}`, debit: 0, credit: adjusted });
      }
    }
    // Oldest first; on the same instant, a bill before what is taken off it.
    const order = { BILL: 0, PAYMENT: 1, RETURN: 2 };
    all.sort((a, b) => a.date.getTime() - b.date.getTime() || order[a.kind] - order[b.kind]);

    let balance = 0;
    const entries = [];
    const totals = { debit: 0, credit: 0 };
    for (const entry of all) {
      if (entry.date >= periodEnd) break;
      balance = round2(balance + entry.debit - entry.credit);
      if (entry.date < periodStart) continue;
      totals.debit = round2(totals.debit + entry.debit);
      totals.credit = round2(totals.credit + entry.credit);
      entries.push({ ...entry, date: entry.date.toISOString(), balance });
    }
    const openingBalance = round2(balance - totals.debit + totals.credit);
    const { buckets, overdue } = this.age(bills, timezone);
    return {
      customer: {
        id: customer.id,
        code: customer.code,
        name: customer.name,
        phone: customer.phone,
        gstin: customer.gstin,
        address: customer.address,
        email: customer.email,
        creditLimit: customer.creditLimit === null ? null : toNumber(customer.creditLimit)
      },
      from,
      to,
      timezone,
      openingBalance,
      entries,
      totals,
      closingBalance: balance,
      ageing: buckets,
      overdue
    };
  }

  /** The statement by email, from the business. */
  async emailStatement(branchId: string, customerId: string, from: string, to: string, email: string) {
    this.mailer.assertConfigured();
    const statement = await this.statement(branchId, customerId, from, to);
    const [business, branch] = await Promise.all([
      this.prisma.businessSettings.findUnique({ where: { id: 'default' }, select: { name: true } }),
      this.prisma.branch.findUnique({ where: { id: branchId }, select: { name: true } })
    ]);
    const storeName = business?.name?.trim() || branch?.name || 'Our store';
    const day = (iso: string) =>
      new Intl.DateTimeFormat('en-IN', { timeZone: statement.timezone, day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(iso));
    const calendarDay = (date: string) => day(`${date}T12:00:00.000Z`);
    const money = (amount: number) => (amount ? amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
    const kindLabel = { BILL: 'Bill', PAYMENT: 'Payment', RETURN: 'Return' };
    const rows = [
      { date: calendarDay(statement.from), what: 'Opening balance', reference: '', debit: '', credit: '', balance: money(statement.openingBalance) || '0.00' },
      ...statement.entries.map((entry) => ({
        date: day(entry.date),
        what: `${kindLabel[entry.kind]}${entry.detail ? `: ${entry.detail}` : ''}`,
        reference: entry.reference,
        debit: money(entry.debit),
        credit: money(entry.credit),
        balance: money(entry.balance) || '0.00'
      })),
      { date: calendarDay(statement.to), what: 'Closing balance', reference: '', debit: money(statement.totals.debit), credit: money(statement.totals.credit), balance: money(statement.closingBalance) || '0.00' }
    ];
    const period = `${calendarDay(statement.from)} to ${calendarDay(statement.to)}`;
    const header = [
      `Statement of account from ${storeName}`,
      `${statement.customer.name} (${statement.customer.code})${statement.customer.gstin ? `, GSTIN ${statement.customer.gstin}` : ''}`,
      period
    ];
    const footer = [
      `Owed now: ${inr(statement.ageing.total)}${statement.overdue > 0 ? `, of which ${inr(statement.overdue)} is overdue` : ''}.`,
      `By age: 0-30 days ${inr(statement.ageing.days0to30)}; 31-60 days ${inr(statement.ageing.days31to60)}; 61-90 days ${inr(statement.ageing.days61to90)}; over 90 days ${inr(statement.ageing.over90)}.`
    ];
    const text = [
      ...header,
      '',
      ...rows.map((row) => [row.date, row.what, row.reference, row.debit && `Dr ${row.debit}`, row.credit && `Cr ${row.credit}`, `Balance ${row.balance}`].filter(Boolean).join(' | ')),
      '',
      ...footer
    ].join('\n');
    const cell = 'padding:4px 8px;border-bottom:1px solid #e2e8f0;text-align:left';
    const num = `${cell};text-align:right;font-variant-numeric:tabular-nums`;
    const html = `<!doctype html><html><body style="margin:0;padding:16px;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111827"><div style="display:inline-block;padding:16px;background:#fff;border:1px solid #e2e8f0">${header
      .map((line, index) => `<div style="${index === 0 ? 'font-size:16px;font-weight:700;margin-bottom:4px' : 'color:#475569'}">${escapeHtml(line)}</div>`)
      .join('')}<table style="border-collapse:collapse;margin-top:12px"><thead><tr><th style="${cell}">Date</th><th style="${cell}">Particulars</th><th style="${cell}">Ref</th><th style="${num}">Debit</th><th style="${num}">Credit</th><th style="${num}">Balance</th></tr></thead><tbody>${rows
      .map(
        (row) =>
          `<tr><td style="${cell};white-space:nowrap">${escapeHtml(row.date)}</td><td style="${cell}">${escapeHtml(row.what)}</td><td style="${cell}">${escapeHtml(row.reference)}</td><td style="${num}">${row.debit}</td><td style="${num}">${row.credit}</td><td style="${num}">${row.balance}</td></tr>`
      )
      .join('')}</tbody></table>${footer.map((line) => `<p style="margin:8px 0 0">${escapeHtml(line)}</p>`).join('')}</div></body></html>`;
    await this.mailer.send({ to: email, subject: `Statement of account from ${storeName}: ${period}`, text, html });
  }
}
