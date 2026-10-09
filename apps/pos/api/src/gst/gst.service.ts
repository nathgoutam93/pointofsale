import { BadRequestException, Injectable } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { round2, toNumber } from '../common/numbers';
import { financialYearStart } from '@pos/contracts';
import { localDate, startOfLocalDay } from '../reports/zoned-dates';
import { SettingsService } from '../settings/settings.service';
import { buildGstr1, type Gstr1Invoice, type Gstr1Line } from './gstr1';
import { buildGstr3b } from './gstr3b';
import { buildComposition } from './composition';

const invoiceSelect = {
  invoiceNo: true,
  documentSeries: true,
  createdAt: true,
  status: true,
  taxpayerType: true,
  compositionCategory: true,
  sellerGstin: true,
  sellerStateCode: true,
  placeOfSupplyStateCode: true,
  buyerGstin: true,
  grandTotal: true,
  lines: {
    select: {
      id: true,
      itemName: true,
      hsnCode: true,
      uqc: true,
      supplyType: true,
      taxRate: true,
      qty: true,
      taxableAmount: true,
      cgstAmount: true,
      sgstAmount: true,
      igstAmount: true
    }
  }
} as const;

type InvoiceRow = {
  invoiceNo: string;
  documentSeries: string | null;
  createdAt: Date;
  status: InvoiceStatus;
  taxpayerType: 'REGULAR' | 'COMPOSITION' | 'UNREGISTERED';
  compositionCategory: Gstr1Invoice['compositionCategory'];
  sellerGstin: string | null;
  sellerStateCode: string | null;
  placeOfSupplyStateCode: string | null;
  buyerGstin: string | null;
  grandTotal: unknown;
  lines: Array<{
    id: string;
    itemName: string;
    hsnCode: string | null;
    uqc: string | null;
    supplyType: Gstr1Line['supplyType'];
    taxRate: unknown;
    qty: unknown;
    taxableAmount: unknown;
    cgstAmount: unknown;
    sgstAmount: unknown;
    igstAmount: unknown;
  }>;
};

const num = (value: unknown) => toNumber(value as Parameters<typeof toNumber>[0]);

function toLine(line: InvoiceRow['lines'][number]): Gstr1Line {
  return {
    itemName: line.itemName,
    hsnCode: line.hsnCode,
    uqc: line.uqc,
    supplyType: line.supplyType,
    taxRate: num(line.taxRate),
    qty: num(line.qty),
    taxable: num(line.taxableAmount),
    cgst: num(line.cgstAmount),
    sgst: num(line.sgstAmount),
    igst: num(line.igstAmount)
  };
}

function toInvoice(row: InvoiceRow): Gstr1Invoice {
  return {
    invoiceNo: row.invoiceNo,
    documentSeries: row.documentSeries,
    createdAt: row.createdAt,
    cancelled: row.status === InvoiceStatus.CANCELLED,
    taxpayerType: row.taxpayerType,
    compositionCategory: row.compositionCategory,
    sellerGstin: row.sellerGstin,
    sellerStateCode: row.sellerStateCode,
    placeOfSupplyStateCode: row.placeOfSupplyStateCode,
    buyerGstin: row.buyerGstin,
    grandTotal: num(row.grandTotal),
    lines: row.lines.map(toLine)
  };
}

/** "YYYY-MM" → year and month. */
function parseMonth(value: string) {
  const [year, month] = value.split('-').map(Number);
  return { year, month };
}

/** One month, a financial-year quarter, a financial year (April-March), or none of these. */
function periodKind(from: string, to: string) {
  const start = parseMonth(from);
  const end = parseMonth(to);
  const months = (end.year - start.year) * 12 + (end.month - start.month) + 1;
  if (months === 1) return 'month';
  if (months === 3 && [1, 4, 7, 10].includes(start.month)) return 'quarter';
  if (months === 12 && start.month === 4) return 'year';
  return null;
}

function assertMonthOrQuarter(from: string, to: string) {
  const kind = periodKind(from, to);
  if (kind !== 'month' && kind !== 'quarter') {
    throw new BadRequestException('Choose one month, or a quarter: April-June, July-September, October-December or January-March');
  }
}

@Injectable()
export class GstService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService
  ) {}

  /** GSTINs there is something to file for: branches', the business's, and any on past sales. */
  async listGstins() {
    const [branches, business, sold] = await Promise.all([
      this.prisma.branch.findMany({ where: { gstin: { not: null } }, select: { gstin: true, name: true } }),
      this.settings.ensureBusinessSettings(),
      this.prisma.saleInvoice.findMany({ where: { sellerGstin: { not: null } }, distinct: ['sellerGstin'], select: { sellerGstin: true } })
    ]);
    const names = new Map<string, string[]>();
    const add = (gstin: string | null | undefined, name?: string) => {
      const key = gstin?.trim().toUpperCase();
      if (!key) return;
      names.set(key, [...(names.get(key) ?? []), ...(name ? [name] : [])]);
    };
    branches.forEach((branch) => add(branch.gstin, branch.name));
    add(business.gstNumber, 'Business GSTIN');
    sold.forEach((row) => add(row.sellerGstin));
    return [...names.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([gstin, labels]) => ({ gstin, label: labels.length ? labels.join(', ') : 'From past sales' }));
  }

  /**
   * GSTR-1 for a GSTIN over one month, or one quarter (April-June, July-September,
   * October-December, January-March) for quarterly filers.
   */
  async gstr1(gstin: string, from: string, to: string) {
    assertMonthOrQuarter(from, to);
    return { gstin, from, to, ...buildGstr1(await this.loadPeriod(gstin, from, to)) };
  }

  /** The sales side of GSTR-3B for the same periods, from the same figures as GSTR-1. */
  async gstr3b(gstin: string, from: string, to: string) {
    assertMonthOrQuarter(from, to);
    const [period, itc] = await Promise.all([this.loadPeriod(gstin, from, to), this.purchaseItc(gstin, from, to)]);
    return { gstin, from, to, ...buildGstr3b(buildGstr1(period), itc) };
  }

  /**
   * Input tax credit from purchases bought under `gstin` in the months from-to: those it counts
   * for (a registered supplier, a regular taxpayer), by the supplier's invoice date when entered,
   * else the day the goods were received.
   */
  private async purchaseItc(gstin: string, from: string, to: string) {
    const start = parseMonth(from);
    const end = parseMonth(to);
    const { timezone } = await this.settings.ensureBusinessSettings();
    const firstDay = `${start.year}-${String(start.month).padStart(2, '0')}-01`;
    const next = end.month === 12 ? { year: end.year + 1, month: 1 } : { year: end.year, month: end.month + 1 };
    const afterLastDay = `${next.year}-${String(next.month).padStart(2, '0')}-01`;
    const received = { gte: startOfLocalDay(start.year, start.month, 1, timezone), lt: startOfLocalDay(next.year, next.month, 1, timezone) };
    const where = {
      buyerGstin: gstin,
      itcEligible: true,
      OR: [{ supplierInvoiceDate: { gte: firstDay, lt: afterLastDay } }, { supplierInvoiceDate: null, createdAt: received }]
    };
    // Goods sent back in the period take their GST off again (the supplier's credit note).
    const [totals, returned] = await Promise.all([
      this.prisma.purchase.aggregate({ where, _count: true, _sum: { igstTotal: true, cgstTotal: true, sgstTotal: true } }),
      this.prisma.purchaseReturn.aggregate({
        where: { itcReversed: true, purchase: { buyerGstin: gstin }, createdAt: received },
        _count: true,
        _sum: { igstTotal: true, cgstTotal: true, sgstTotal: true }
      })
    ]);
    const net = (bought: unknown, sentBack: unknown) => round2(num(bought) - num(sentBack));
    return {
      purchases: totals._count,
      purchaseReturns: returned._count,
      igst: net(totals._sum.igstTotal, returned._sum.igstTotal),
      cgst: net(totals._sum.cgstTotal, returned._sum.cgstTotal),
      sgst: net(totals._sum.sgstTotal, returned._sum.sgstTotal)
    };
  }

  /** CMP-08: a composition taxpayer's quarter. */
  async cmp08(gstin: string, from: string, to: string) {
    if (periodKind(from, to) !== 'quarter') {
      throw new BadRequestException('CMP-08 is for a quarter: April-June, July-September, October-December or January-March');
    }
    const start = parseMonth(from);
    return { gstin, from, to, ...(await this.composition(gstin, from, to, financialYearStart(start.year, start.month))) };
  }

  /** GSTR-4: a composition taxpayer's financial year (April to March), quarter by quarter. */
  async gstr4(gstin: string, fy: number) {
    const from = `${fy}-04`;
    const to = `${fy + 1}-03`;
    const { timezone } = await this.settings.ensureBusinessSettings();
    const quarterOf = (at: Date) => Math.floor(((localDate(at, timezone).month + 8) % 12) / 3) + 1;
    return { gstin, fy, ...(await this.composition(gstin, from, to, fy, quarterOf)) };
  }

  private async composition(gstin: string, from: string, to: string, fy: number, quarterOf?: (at: Date) => number) {
    const [period, yearTurnover, current] = await Promise.all([
      this.loadPeriod(gstin, from, to),
      this.turnoverForYear(fy),
      this.settings.taxpayerTypeAt(new Date())
    ]);
    return buildComposition({ ...period, yearTurnover, currentCategory: current.compositionCategory, quarterOf });
  }

  /** The business's turnover (taxable value, all GSTINs) in a financial year, net of returns. */
  private async turnoverForYear(fy: number) {
    const { timezone } = await this.settings.ensureBusinessSettings();
    const range = { gte: startOfLocalDay(fy, 4, 1, timezone), lt: startOfLocalDay(fy + 1, 4, 1, timezone) };
    const [sold, returned] = await Promise.all([
      this.prisma.saleInvoiceLine.aggregate({
        _sum: { taxableAmount: true },
        where: { invoice: { createdAt: range, status: { not: InvoiceStatus.CANCELLED } } }
      }),
      this.prisma.returnInvoiceLine.aggregate({ _sum: { taxableAmount: true }, where: { returnInvoice: { createdAt: range } } })
    ]);
    return num(sold._sum.taxableAmount) - num(returned._sum.taxableAmount);
  }

  /** A GSTIN's invoices and returns for a month or quarter, as the return builders take them. */
  private async loadPeriod(gstin: string, from: string, to: string) {
    const start = parseMonth(from);
    const end = parseMonth(to);

    const { timezone } = await this.settings.ensureBusinessSettings();
    const periodStart = startOfLocalDay(start.year, start.month, 1, timezone);
    const periodEnd = startOfLocalDay(end.year, end.month + 1, 1, timezone);
    const inPeriod = { gte: periodStart, lt: periodEnd };

    const [invoices, invoicesWithoutGstin, returns] = await Promise.all([
      this.prisma.saleInvoice.findMany({ where: { sellerGstin: gstin, createdAt: inPeriod }, select: invoiceSelect, orderBy: { createdAt: 'asc' } }),
      // Sales with no GSTIN that could be this GSTIN's: made in its state, or at a branch with no state.
      this.prisma.saleInvoice.count({
        where: { sellerGstin: null, createdAt: inPeriod, OR: [{ sellerStateCode: gstin.slice(0, 2) }, { sellerStateCode: null }] }
      }),
      this.prisma.returnInvoice.findMany({
        where: { saleInvoice: { sellerGstin: gstin }, createdAt: inPeriod },
        orderBy: { createdAt: 'asc' },
        select: {
          returnNo: true,
          documentSeries: true,
          createdAt: true,
          totalAmount: true,
          saleInvoice: { select: invoiceSelect },
          lines: {
            select: {
              saleLineId: true,
              qty: true,
              taxableAmount: true,
              cgstAmount: true,
              sgstAmount: true,
              igstAmount: true
            }
          }
        }
      })
    ]);

    return {
      gstin,
      fp: `${String(end.month).padStart(2, '0')}${end.year}`,
      timeZone: timezone,
      invoicesWithoutGstin,
      invoices: invoices.map((row) => toInvoice(row as InvoiceRow)),
      returns: returns.map((ret) => {
        const invoiceRow = ret.saleInvoice as InvoiceRow;
        const saleLines = new Map(invoiceRow.lines.map((line) => [line.id, toLine(line)]));
        return {
          returnNo: ret.returnNo,
          documentSeries: ret.documentSeries,
          createdAt: ret.createdAt,
          totalAmount: num(ret.totalAmount),
          invoice: toInvoice(invoiceRow),
          lines: ret.lines.map((line) => ({
            saleLine: saleLines.get(line.saleLineId)!,
            qty: num(line.qty),
            taxable: num(line.taxableAmount),
            cgst: num(line.cgstAmount),
            sgst: num(line.sgstAmount),
            igst: num(line.igstAmount)
          }))
        };
      })
    };
  }
}
