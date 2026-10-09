import { HttpException, Injectable } from '@nestjs/common';
import { APP_VERSION, gstStateLabel } from '@pos/contracts';
import { InvoiceStatus } from '@prisma/client';
import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createBackup } from '../backup/local-backup';
import { round2, toNumber } from '../common/numbers';
import { uploadsDir } from '../common/uploads';
import { PrismaService } from '../prisma.service';
import { localDate, startOfLocalDay } from '../reports/zoned-dates';
import { SettingsService } from '../settings/settings.service';
import { currentBusiness } from '../tenancy/tenant-context';

/** One full export at a time per business, and a few an hour: each reads every table. */
const EXPORTS_PER_HOUR = 6;
const running = new Set<string>();
const recent = new Map<string, number[]>();

/** A CSV field: quoted when it has a comma, quote or line break; a leading = + - @ is defused for spreadsheets. */
function csvField(value: string | number | null | undefined) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  DRAFT: 'Unpaid',
  PARTIALLY_SETTLED: 'Part paid',
  SETTLED: 'Paid',
  CANCELLED: 'Cancelled'
};

/**
 * A business's data to take away: everything, in the local backup format (an offline install
 * restores it), or the sales register as CSV for an accountant.
 */
@Injectable()
export class ExportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService
  ) {}

  /**
   * Every table of the business, with its logos and item pictures, as a backup file. The caller
   * streams `file` and then removes `dir`, and calls `done()` either way.
   */
  async fullExport() {
    const key = currentBusiness()?.id ?? 'local';
    const now = Date.now();
    const lastHour = (recent.get(key) ?? []).filter((at) => at > now - 60 * 60 * 1000);
    if (running.has(key)) throw new HttpException('An export of this business is already being made. Wait for it to finish.', 429);
    if (lastHour.length >= EXPORTS_PER_HOUR) throw new HttpException('Too many exports in the last hour. Try again later.', 429);
    running.add(key);
    recent.set(key, [...lastHour, now]);
    try {
      const [settings, branches, items] = await Promise.all([
        this.prisma.businessSettings.findUnique({ where: { id: 'default' }, select: { logoUrl: true } }),
        this.prisma.branch.findMany({ select: { logoUrl: true } }),
        this.prisma.item.findMany({ where: { imageUrl: { not: null } }, select: { imageUrl: true } })
      ]);
      // Only this business's files: the uploads folder may be shared by every business on the server.
      const uploadFiles = [settings?.logoUrl, ...branches.map((branch) => branch.logoUrl), ...items.map((item) => item.imageUrl)]
        .filter((url): url is string => !!url && url.startsWith('/uploads/') && !url.includes('..'))
        .map((url) => url.slice('/uploads/'.length));
      const dir = await mkdtemp(join(tmpdir(), 'pos-export-'));
      const file = await createBackup({ prisma: this.prisma, dir, uploadsDir, reason: 'export', appVersion: APP_VERSION, uploadFiles: [...new Set(uploadFiles)] });
      return { file, dir, done: () => running.delete(key) };
    } catch (error) {
      running.delete(key);
      throw error;
    }
  }

  /**
   * Sales and credit notes from `from` to `to` (calendar dates in the business's time zone) at
   * the branches given, one row each, with the tax split and what was paid and is still owed.
   */
  async salesCsv(branchIds: string[], from: string, to: string) {
    const { timezone } = await this.settings.ensureBusinessSettings();
    const [fy, fm, fd] = from.split('-').map(Number);
    const [ty, tm, td] = to.split('-').map(Number);
    const range = { gte: startOfLocalDay(fy, fm, fd, timezone), lt: startOfLocalDay(ty, tm, td + 1, timezone) };
    const day = (date: Date) => {
      const { year, month, day: d } = localDate(date, timezone);
      return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    };
    const [invoices, returns] = await Promise.all([
      this.prisma.saleInvoice.findMany({
        where: { branchId: { in: branchIds }, createdAt: range },
        include: { branch: { select: { code: true } }, payments: { select: { mode: true, amount: true } } },
        orderBy: { createdAt: 'asc' }
      }),
      this.prisma.returnInvoice.findMany({
        where: { saleInvoice: { branchId: { in: branchIds } }, createdAt: range },
        include: { saleInvoice: { select: { invoiceNo: true, customerName: true, customerPhone: true, buyerGstin: true, placeOfSupplyStateCode: true, sellerStateCode: true, branch: { select: { code: true } } } } },
        orderBy: { createdAt: 'asc' }
      })
    ]);
    const header = [
      'Type', 'Date', 'Number', 'Against invoice', 'Branch', 'Customer', 'Phone', 'Buyer GSTIN', 'Place of supply',
      'Taxable value', 'CGST', 'SGST', 'IGST', 'Round off', 'Total', 'Paid', 'Credited by returns', 'Owed', 'Refunded', 'Status', 'Payments'
    ];
    const place = (code: string | null, seller: string | null) => {
      const state = code ?? seller;
      return state ? gstStateLabel(state) : '';
    };
    const rows: Array<Array<string | number | null>> = [];
    for (const invoice of invoices) {
      const total = toNumber(invoice.grandTotal);
      const paid = toNumber(invoice.paidTotal);
      const credited = toNumber(invoice.creditedTotal);
      const byMode = new Map<string, number>();
      for (const payment of invoice.payments) byMode.set(payment.mode, round2((byMode.get(payment.mode) ?? 0) + toNumber(payment.amount)));
      rows.push([
        'Invoice',
        day(invoice.createdAt),
        invoice.invoiceNo,
        null,
        invoice.branch.code,
        invoice.customerName,
        invoice.customerPhone,
        invoice.buyerGstin,
        place(invoice.placeOfSupplyStateCode, invoice.sellerStateCode),
        round2(total - toNumber(invoice.taxTotal) - toNumber(invoice.roundOff)),
        toNumber(invoice.cgstTotal),
        toNumber(invoice.sgstTotal),
        toNumber(invoice.igstTotal),
        toNumber(invoice.roundOff),
        total,
        paid,
        credited,
        invoice.status === InvoiceStatus.CANCELLED ? 0 : round2(Math.max(0, total - paid - credited)),
        null,
        STATUS_LABEL[invoice.status],
        [...byMode].map(([mode, amount]) => `${mode} ${amount.toFixed(2)}`).join('; ')
      ]);
    }
    for (const ret of returns) {
      const bill = ret.saleInvoice;
      rows.push([
        'Credit note',
        day(ret.createdAt),
        ret.returnNo,
        bill.invoiceNo,
        bill.branch.code,
        bill.customerName,
        bill.customerPhone,
        bill.buyerGstin,
        place(bill.placeOfSupplyStateCode, bill.sellerStateCode),
        -toNumber(ret.taxableTotal),
        -toNumber(ret.cgstTotal),
        -toNumber(ret.sgstTotal),
        -toNumber(ret.igstTotal),
        -toNumber(ret.roundOff),
        -toNumber(ret.totalAmount),
        null,
        null,
        null,
        toNumber(ret.refundAmount),
        null,
        toNumber(ret.refundAmount) > 0 ? `Refund ${ret.refundMode} ${toNumber(ret.refundAmount).toFixed(2)}` : ''
      ]);
    }
    rows.sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    // A byte order mark, so spreadsheet programs read the file as UTF-8 (names in any script).
    return '﻿' + [header, ...rows].map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n';
  }
}
