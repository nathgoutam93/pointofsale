import { BadRequestException, Injectable } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { toNumber } from '../common/numbers';
import { startOfLocalDay } from '../reports/zoned-dates';
import { SettingsService } from '../settings/settings.service';
import { buildGstr1, type Gstr1Invoice, type Gstr1Line } from './gstr1';

const invoiceSelect = {
  invoiceNo: true,
  documentSeries: true,
  createdAt: true,
  status: true,
  taxpayerType: true,
  sellerGstin: true,
  sellerStateCode: true,
  placeOfSupplyStateCode: true,
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
  taxpayerType: 'REGULAR' | 'COMPOSITION';
  sellerGstin: string | null;
  sellerStateCode: string | null;
  placeOfSupplyStateCode: string | null;
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
    sellerGstin: row.sellerGstin,
    sellerStateCode: row.sellerStateCode,
    placeOfSupplyStateCode: row.placeOfSupplyStateCode,
    grandTotal: num(row.grandTotal),
    lines: row.lines.map(toLine)
  };
}

/** "YYYY-MM" → year and month. */
function parseMonth(value: string) {
  const [year, month] = value.split('-').map(Number);
  return { year, month };
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
    const start = parseMonth(from);
    const end = parseMonth(to);
    const months = (end.year - start.year) * 12 + (end.month - start.month) + 1;
    const isQuarter = months === 3 && [1, 4, 7, 10].includes(start.month);
    if (months !== 1 && !isQuarter) {
      throw new BadRequestException('Choose one month, or a quarter: April-June, July-September, October-December or January-March');
    }

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

    const result = buildGstr1({
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
    });
    return { gstin, from, to, ...result };
  }
}
