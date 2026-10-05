import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { reportPeriods, startOfLocalDay } from './zoned-dates';
import { RegistersService } from '../registers/registers.service';
import { registerSelect } from '../common/selects';
import type { SessionUser } from '../common/types';
import { toNumber, round2 } from '../common/numbers';
import { SettingsService } from '../settings/settings.service';
import { BranchesService } from '../branches/branches.service';

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly branches: BranchesService,
    private readonly registers: RegistersService
  ) {}

  /**
   * Sales figures for one date range. A sale counts in the range it was made in, paid or not
   * (cancelled bills never count), so a closed period's figures don't change when a credit
   * bill from it is paid later; what is still owed on them is shown too, and the money taken
   * in the range (by payment mode, whenever the bill was made) separately. Amounts are split
   * into tax and net so profit is worked out on net sales, and cost of goods sold uses the cost
   * recorded on each sale line. Adding stock (opening, adjustments in) is not an expense: it
   * only becomes cost when sold.
   */
  private async computeReportRange(
    branchIds: string[],
    range: { label: string; startDate: Date | null; endDate: Date | null }
  ) {
    const inBranches = Prisma.sql`i."branchId" IN (${Prisma.join(branchIds)})`;
    const inRange = (column: Prisma.Sql) =>
      range.startDate && range.endDate
        ? Prisma.sql`AND ${column} >= ${range.startDate} AND ${column} < ${range.endDate}`
        : Prisma.empty;

    const [sales, cogs, unpaid, returns, collected] = await Promise.all([
      this.prisma.$queryRaw<Array<{ gross: Prisma.Decimal | null; tax: Prisma.Decimal | null; count: bigint }>>`
        SELECT SUM(i."grandTotal") AS gross, SUM(i."taxTotal") AS tax, COUNT(*) AS count
        FROM "SaleInvoice" i
        WHERE ${inBranches} AND i."status" <> 'CANCELLED' ${inRange(Prisma.sql`i."createdAt"`)}`,
      this.prisma.$queryRaw<Array<{ cost: Prisma.Decimal | null }>>`
        SELECT SUM(l."qty" * COALESCE(l."unitCost", 0)) AS cost
        FROM "SaleInvoiceLine" l JOIN "SaleInvoice" i ON i."id" = l."invoiceId"
        WHERE ${inBranches} AND i."status" <> 'CANCELLED' ${inRange(Prisma.sql`i."createdAt"`)}`,
      this.prisma.$queryRaw<Array<{ due: Prisma.Decimal | null }>>`
        SELECT SUM(i."grandTotal" - i."paidTotal" - i."creditedTotal") AS due
        FROM "SaleInvoice" i
        WHERE ${inBranches} AND i."status" IN ('DRAFT', 'PARTIALLY_SETTLED') ${inRange(Prisma.sql`i."createdAt"`)}`,
      // A return's net (pre-tax) part uses its sale line's own taxable/net ratio; it counts in the
      // range the return was made in.
      this.prisma.$queryRaw<Array<{ gross: Prisma.Decimal | null; net: Prisma.Decimal | null; cost: Prisma.Decimal | null }>>`
        SELECT SUM(rl."amount") AS gross,
               SUM(CASE WHEN sl."netAmount" > 0 THEN rl."amount" * sl."taxableAmount" / sl."netAmount" ELSE 0 END) AS net,
               SUM(rl."qty" * COALESCE(sl."unitCost", 0)) AS cost
        FROM "ReturnInvoiceLine" rl
        JOIN "ReturnInvoice" r ON r."id" = rl."returnInvoiceId"
        JOIN "SaleInvoiceLine" sl ON sl."id" = rl."saleLineId"
        JOIN "SaleInvoice" i ON i."id" = sl."invoiceId"
        WHERE ${inBranches} AND i."status" <> 'CANCELLED' ${inRange(Prisma.sql`r."createdAt"`)}`,
      // Money taken in the range, by how it was paid, on this branch's bills.
      this.prisma.$queryRaw<Array<{ mode: string; amount: Prisma.Decimal | null }>>`
        SELECT p."mode"::text AS mode, SUM(p."amount") AS amount
        FROM "Payment" p JOIN "SaleInvoice" i ON i."id" = p."invoiceId"
        WHERE ${inBranches} ${inRange(Prisma.sql`p."createdAt"`)}
        GROUP BY p."mode"`
    ]);
    const collectedBy = (mode: string) => round2(toNumber(collected.find((row) => row.mode === mode)?.amount ?? 0));

    const grossSales = round2(toNumber(sales[0]?.gross ?? 0));
    const taxCollected = round2(toNumber(sales[0]?.tax ?? 0));
    const returnsGross = round2(toNumber(returns[0]?.gross ?? 0));
    const returnsNet = round2(toNumber(returns[0]?.net ?? 0));
    const netSales = round2(grossSales - taxCollected - returnsNet);
    const costOfGoodsSold = round2(toNumber(cogs[0]?.cost ?? 0) - toNumber(returns[0]?.cost ?? 0));

    return {
      label: range.label,
      startDate: range.startDate ? range.startDate.toISOString() : null,
      endDate: range.endDate ? range.endDate.toISOString() : null,
      invoiceCount: Number(sales[0]?.count ?? 0),
      grossSales,
      taxCollected,
      returnsGross,
      returnsNet,
      netSales,
      costOfGoodsSold,
      grossProfit: round2(netSales - costOfGoodsSold),
      unpaidSales: round2(toNumber(unpaid[0]?.due ?? 0)),
      collections: {
        cash: collectedBy('CASH'),
        card: collectedBy('CARD'),
        upi: collectedBy('UPI'),
        wallet: collectedBy('WALLET')
      }
    };
  }

  async getSalesSummary(session: SessionUser, branchId: string) {
    // Admins compare branches, so any branch they have access to is allowed, not just the
    // one their register is open in.
    await this.settings.ensureBranchExists(branchId);
    await this.branches.ensureUserHasBranchAccess(session.userId, branchId);

    const now = new Date();
    // Periods follow the shop's clock (business time zone), not the server's.
    const { timezone } = await this.settings.ensureBusinessSettings();
    const periods = reportPeriods(now, timezone);

    const ranges = [
      { label: 'Today', startDate: periods.today.start, endDate: periods.today.end },
      { label: 'This Week', startDate: periods.week.start, endDate: periods.week.end },
      { label: 'This Month', startDate: periods.month.start, endDate: periods.month.end },
      {
        label: 'Overall',
        startDate: null,
        endDate: null
      }
    ];

    const summaries = await Promise.all(ranges.map((range) => this.computeReportRange([branchId], range)));

    return {
      branchId,
      generatedAt: now.toISOString(),
      timezone,
      ranges: summaries
    };
  }

  /**
   * Everything an owner asks of a period (from and to are days in the business time zone), for
   * one branch or every branch the admin manages: the summary, sales by item, category and
   * cashier, discounts given, and the day-end figures of each register open in it.
   */
  async getDetail(session: SessionUser, input: { branchId?: string; from: string; to: string }) {
    if (session.role !== UserRole.ADMIN) throw new ForbiddenException('Admin role required');
    const { timezone } = await this.settings.ensureBusinessSettings();
    const [fy, fm, fd] = input.from.split('-').map(Number);
    const [ty, tm, td] = input.to.split('-').map(Number);
    const start = startOfLocalDay(fy, fm, fd, timezone);
    const end = startOfLocalDay(ty, tm, td + 1, timezone);
    if (!(end > start)) throw new BadRequestException('The period must end on or after its start');
    if (end.getTime() - start.getTime() > 367 * 86_400_000) throw new BadRequestException('A report covers at most 366 days');

    let branchIds: string[];
    if (input.branchId) {
      await this.settings.ensureBranchExists(input.branchId);
      await this.branches.ensureUserHasBranchAccess(session.userId, input.branchId);
      branchIds = [input.branchId];
    } else {
      const accesses = await this.prisma.userBranchAccess.findMany({ where: { userId: session.userId }, select: { branchId: true } });
      branchIds = accesses.map((access) => access.branchId);
    }
    if (branchIds.length === 0) throw new BadRequestException('No branch to report on');
    const inBranches = Prisma.sql`i."branchId" IN (${Prisma.join(branchIds)})`;
    const madeIn = (column: Prisma.Sql) => Prisma.sql`${column} >= ${start} AND ${column} < ${end}`;
    type Amount = Prisma.Decimal | null;

    const [summary, sold, returned, cashiers, cashierReturns, discounts, registers, expenses] = await Promise.all([
      this.computeReportRange(branchIds, { label: `${input.from} to ${input.to}`, startDate: start, endDate: end }),
      // Lines sold on the period's bills, by item.
      this.prisma.$queryRaw<Array<{ itemId: string; itemName: string; category: string | null; qty: Amount; sales: Amount; tax: Amount; cost: Amount }>>`
        SELECT l."itemId", MAX(it."name") AS "itemName", MAX(it."category") AS category,
               SUM(l."qty") AS qty, SUM(l."taxableAmount") AS sales, SUM(l."taxAmount") AS tax,
               SUM(l."qty" * COALESCE(l."unitCost", 0)) AS cost
        FROM "SaleInvoiceLine" l
        JOIN "SaleInvoice" i ON i."id" = l."invoiceId"
        JOIN "Item" it ON it."id" = l."itemId"
        WHERE ${inBranches} AND i."status" <> 'CANCELLED' AND ${madeIn(Prisma.sql`i."createdAt"`)}
        GROUP BY l."itemId"`,
      // What came back in the period, by item.
      this.prisma.$queryRaw<Array<{ itemId: string; qty: Amount; sales: Amount; tax: Amount; cost: Amount }>>`
        SELECT sl."itemId", SUM(rl."qty") AS qty, SUM(rl."taxableAmount") AS sales, SUM(rl."taxAmount") AS tax,
               SUM(rl."qty" * COALESCE(sl."unitCost", 0)) AS cost
        FROM "ReturnInvoiceLine" rl
        JOIN "ReturnInvoice" r ON r."id" = rl."returnInvoiceId"
        JOIN "SaleInvoiceLine" sl ON sl."id" = rl."saleLineId"
        JOIN "SaleInvoice" i ON i."id" = sl."invoiceId"
        WHERE ${inBranches} AND ${madeIn(Prisma.sql`r."createdAt"`)}
        GROUP BY sl."itemId"`,
      this.prisma.$queryRaw<Array<{ userId: string; name: string; invoices: bigint; sales: Amount }>>`
        SELECT i."createdBy" AS "userId", MAX(i."createdByName") AS name, COUNT(*) AS invoices, SUM(i."grandTotal") AS sales
        FROM "SaleInvoice" i
        WHERE ${inBranches} AND i."status" <> 'CANCELLED' AND ${madeIn(Prisma.sql`i."createdAt"`)}
        GROUP BY i."createdBy"`,
      this.prisma.$queryRaw<Array<{ userId: string | null; name: string | null; returns: Amount }>>`
        SELECT r."createdBy" AS "userId", MAX(r."createdByName") AS name, SUM(r."totalAmount") AS returns
        FROM "ReturnInvoice" r JOIN "SaleInvoice" i ON i."id" = r."saleInvoiceId"
        WHERE ${inBranches} AND ${madeIn(Prisma.sql`r."createdAt"`)}
        GROUP BY r."createdBy"`,
      this.prisma.$queryRaw<Array<{ total: Amount; orders: Amount }>>`
        SELECT SUM(i."discountTotal") AS total, SUM(i."orderDiscountAmount") AS orders
        FROM "SaleInvoice" i
        WHERE ${inBranches} AND i."status" <> 'CANCELLED' AND ${madeIn(Prisma.sql`i."createdAt"`)}`,
      // Registers open at any time in the period.
      this.prisma.registerSession.findMany({
        where: { branchId: { in: branchIds }, openedAt: { lt: end }, OR: [{ closedAt: null }, { closedAt: { gte: start } }] },
        orderBy: { openedAt: 'asc' },
        select: { ...registerSelect, branch: { select: { name: true } } }
      }),
      // Expenses by the day paid (the period's calendar days).
      this.prisma.expense.groupBy({
        by: ['category'],
        where: { branchId: { in: branchIds }, date: { gte: input.from, lte: input.to } },
        _sum: { amount: true },
        _count: { _all: true }
      })
    ]);

    const n = (value: Amount | bigint | undefined) => toNumber(value === undefined ? 0 : (value as Prisma.Decimal | null));
    const returnedByItem = new Map(returned.map((row) => [row.itemId, row]));
    const items = sold.map((row) => {
      const back = returnedByItem.get(row.itemId);
      const sales = round2(n(row.sales) - n(back?.sales));
      const cost = round2(n(row.cost) - n(back?.cost));
      return {
        itemId: row.itemId,
        itemName: row.itemName,
        category: row.category,
        qty: Math.round((n(row.qty) - n(back?.qty)) * 1000) / 1000,
        sales,
        tax: round2(n(row.tax) - n(back?.tax)),
        cost,
        profit: round2(sales - cost)
      };
    });
    // Goods returned in the period from bills of earlier periods.
    for (const back of returned.filter((row) => !sold.some((line) => line.itemId === row.itemId))) {
      const item = await this.prisma.item.findUnique({ where: { id: back.itemId }, select: { name: true, category: true } });
      const sales = -round2(n(back.sales));
      const cost = -round2(n(back.cost));
      items.push({ itemId: back.itemId, itemName: item?.name ?? '', category: item?.category ?? null, qty: -n(back.qty), sales, tax: -round2(n(back.tax)), cost, profit: round2(sales - cost) });
    }
    items.sort((a, b) => b.sales - a.sales || a.itemName.localeCompare(b.itemName));

    const byCategory = new Map<string, { category: string | null; qty: number; sales: number; tax: number; cost: number; profit: number }>();
    for (const item of items) {
      const key = item.category ?? '';
      const row = byCategory.get(key) ?? { category: item.category, qty: 0, sales: 0, tax: 0, cost: 0, profit: 0 };
      row.qty = Math.round((row.qty + item.qty) * 1000) / 1000;
      row.sales = round2(row.sales + item.sales);
      row.tax = round2(row.tax + item.tax);
      row.cost = round2(row.cost + item.cost);
      row.profit = round2(row.profit + item.profit);
      byCategory.set(key, row);
    }

    const cashierRows = new Map<string, { userId: string; name: string; invoices: number; sales: number; returns: number }>();
    for (const row of cashiers) cashierRows.set(row.userId, { userId: row.userId, name: row.name, invoices: Number(row.invoices), sales: round2(n(row.sales)), returns: 0 });
    for (const row of cashierReturns) {
      const key = row.userId ?? '';
      const entry = cashierRows.get(key) ?? { userId: key, name: row.name ?? 'Not recorded', invoices: 0, sales: 0, returns: 0 };
      entry.returns = round2(entry.returns + n(row.returns));
      cashierRows.set(key, entry);
    }

    const registerRows = [];
    for (const register of registers) {
      const cash = await this.registers.registerCash(this.prisma, register.id, toNumber(register.openingBalance));
      const optional = (value: Prisma.Decimal | null) => (value === null ? null : toNumber(value));
      registerRows.push({
        id: register.id,
        branchId: register.branchId,
        branchName: register.branch.name,
        counterId: register.counterId,
        counterName: register.counter.name,
        openedBy: register.user.username,
        openingBalance: toNumber(register.openingBalance),
        closingBalance: optional(register.closingBalance),
        cashDifference: optional(register.cashDifference),
        openedAt: register.openedAt,
        closedAt: register.closedAt,
        ...cash
      });
    }

    const totalDiscount = round2(n(discounts[0]?.total));
    const orderDiscount = round2(n(discounts[0]?.orders));
    return {
      from: input.from,
      to: input.to,
      timezone,
      branchIds,
      summary,
      items,
      categories: [...byCategory.values()].sort((a, b) => b.sales - a.sales),
      cashiers: [...cashierRows.values()].sort((a, b) => b.sales - a.sales),
      discounts: { item: round2(totalDiscount - orderDiscount), order: orderDiscount },
      registers: registerRows,
      expenses: {
        byCategory: expenses
          .map((row) => ({ category: row.category, count: row._count._all, total: round2(toNumber(row._sum.amount)) }))
          .sort((a, b) => b.total - a.total),
        total: round2(expenses.reduce((sum, row) => sum + toNumber(row._sum.amount), 0))
      }
    };
  }
}
