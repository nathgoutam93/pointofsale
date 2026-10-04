import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { reportPeriods } from './zoned-dates';
import type { SessionUser } from '../common/types';
import { toNumber, round2 } from '../common/numbers';
import { SettingsService } from '../settings/settings.service';
import { BranchesService } from '../branches/branches.service';

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly branches: BranchesService
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
    branchId: string,
    range: { label: string; startDate: Date | null; endDate: Date | null }
  ) {
    const inRange = (column: Prisma.Sql) =>
      range.startDate && range.endDate
        ? Prisma.sql`AND ${column} >= ${range.startDate} AND ${column} < ${range.endDate}`
        : Prisma.empty;

    const [sales, cogs, unpaid, returns, collected] = await Promise.all([
      this.prisma.$queryRaw<Array<{ gross: Prisma.Decimal | null; tax: Prisma.Decimal | null; count: bigint }>>`
        SELECT SUM(i."grandTotal") AS gross, SUM(i."taxTotal") AS tax, COUNT(*) AS count
        FROM "SaleInvoice" i
        WHERE i."branchId" = ${branchId} AND i."status" <> 'CANCELLED' ${inRange(Prisma.sql`i."createdAt"`)}`,
      this.prisma.$queryRaw<Array<{ cost: Prisma.Decimal | null }>>`
        SELECT SUM(l."qty" * COALESCE(l."unitCost", 0)) AS cost
        FROM "SaleInvoiceLine" l JOIN "SaleInvoice" i ON i."id" = l."invoiceId"
        WHERE i."branchId" = ${branchId} AND i."status" <> 'CANCELLED' ${inRange(Prisma.sql`i."createdAt"`)}`,
      this.prisma.$queryRaw<Array<{ due: Prisma.Decimal | null }>>`
        SELECT SUM(i."grandTotal" - i."paidTotal" - i."creditedTotal") AS due
        FROM "SaleInvoice" i
        WHERE i."branchId" = ${branchId} AND i."status" IN ('DRAFT', 'PARTIALLY_SETTLED') ${inRange(Prisma.sql`i."createdAt"`)}`,
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
        WHERE i."branchId" = ${branchId} AND i."status" <> 'CANCELLED' ${inRange(Prisma.sql`r."createdAt"`)}`,
      // Money taken in the range, by how it was paid, on this branch's bills.
      this.prisma.$queryRaw<Array<{ mode: string; amount: Prisma.Decimal | null }>>`
        SELECT p."mode"::text AS mode, SUM(p."amount") AS amount
        FROM "Payment" p JOIN "SaleInvoice" i ON i."id" = p."invoiceId"
        WHERE i."branchId" = ${branchId} ${inRange(Prisma.sql`p."createdAt"`)}
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

    const summaries = await Promise.all(ranges.map((range) => this.computeReportRange(branchId, range)));

    return {
      branchId,
      generatedAt: now.toISOString(),
      timezone,
      ranges: summaries
    };
  }
}
