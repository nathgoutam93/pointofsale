import { Body, Controller, Get, Headers, HttpCode, NotFoundException, Post, UnauthorizedException } from '@nestjs/common';
import { DocumentKind, Prisma } from '@prisma/client';
import { documentSeries } from '@pos/contracts';
import { timingSafeEqual } from 'crypto';
import { Public } from '../auth/auth.guard';
import { appliedSchemaVersion } from '../backup/local-backup';
import { fallbackCounterId, isFallback } from '../common/mode';
import type { RequestHeaders } from '../common/request-session';
import { PrismaService } from '../prisma.service';
import type { FallbackOutbox } from './fallback.service';

/** The header the desktop app reads the offline sales with: the POS_FALLBACK_SECRET it started this API with. */
export const FALLBACK_SECRET_HEADER = 'x-pos-fallback-secret';

/** What a request may change while a fallback counter works offline; everything else is read-only. */
export const FALLBACK_WRITES = new Set(['POST /auth/login', 'POST /auth/logout', 'POST /registers/open', 'POST /registers/close', 'POST /sales/checkout', 'POST /fallback/numbers']);

const rowsOf = (rows: Array<{ row: Record<string, unknown> }>) => rows.map((entry) => entry.row);

/**
 * A fallback counter's local copy: everything made while working offline, for the desktop app
 * to send to the server. The copy started with no sales, so every invoice here is new.
 */
@Controller()
export class FallbackOutboxController {
  constructor(private readonly prisma: PrismaService) {}

  /** Only the desktop app that started this API, with its secret. */
  private assertApp(headers: RequestHeaders) {
    const counterId = fallbackCounterId();
    if (!isFallback() || !counterId) throw new NotFoundException();
    const sent = Buffer.from(String(headers[FALLBACK_SECRET_HEADER] ?? ''));
    const expected = Buffer.from(process.env.POS_FALLBACK_SECRET ?? '');
    if (expected.length < 32 || sent.length !== expected.length || !timingSafeEqual(sent, expected)) {
      throw new UnauthorizedException();
    }
    return counterId;
  }

  /**
   * Before selling offline: the last invoice numbers the app saw this counter issue online
   * (after the copy was made), so offline invoices carry on after them. Numbers of other
   * series are ignored; a number lower than the copy's changes nothing.
   */
  @Public()
  @Post('/fallback/numbers')
  @HttpCode(200)
  async numbers(@Headers() headers: RequestHeaders, @Body() body: { invoiceNumbers?: unknown }) {
    const counterId = this.assertApp(headers);
    const counter = await this.prisma.counter.findUniqueOrThrow({ where: { id: counterId }, select: { number: true, branch: { select: { code: true } } } });
    const series = documentSeries(counter.branch.code, counter.number, DocumentKind.INVOICE);
    let moved = 0;
    for (const invoiceNo of Array.isArray(body?.invoiceNumbers) ? body.invoiceNumbers : []) {
      // {series}/{YY}/{number}
      const match = typeof invoiceNo === 'string' && invoiceNo.startsWith(`${series}/`) ? /^(\d{2})\/(\d+)$/.exec(invoiceNo.slice(series.length + 1)) : null;
      if (!match) continue;
      const fiscalYear = 2000 + Number(match[1]);
      moved += await this.prisma.$executeRaw`
        INSERT INTO "DocumentSequence" ("kind", "series", "fiscalYear", "lastSeq")
        VALUES ('INVOICE'::"DocumentKind", ${series}, ${fiscalYear}, ${Number(match[2])})
        ON CONFLICT ("kind", "series", "fiscalYear") DO UPDATE SET "lastSeq" = GREATEST("DocumentSequence"."lastSeq", EXCLUDED."lastSeq")`;
    }
    return { moved };
  }

  @Public()
  @Get('/fallback/outbox')
  async outbox(@Headers() headers: RequestHeaders): Promise<FallbackOutbox> {
    const counterId = this.assertApp(headers);
    const counter = await this.prisma.counter.findUniqueOrThrow({
      where: { id: counterId },
      select: { number: true, fallbackReceiptSeq: true, branch: { select: { code: true } } }
    });
    // One consistent read: the sale being made right now is either wholly in or wholly out.
    const { registers, invoices, lines, discounts, allocations, payments, receipts, ledger, sequences } = await this.prisma.$transaction(
      async (tx) => {
        const select = async (table: string, where = 'true') =>
          rowsOf(await tx.$queryRawUnsafe<Array<{ row: Record<string, unknown> }>>(`SELECT row_to_json(t) AS row FROM "${table}" t WHERE ${where}`));
        return {
          registers: await select('RegisterSession', `"counterId" = '${counterId.replace(/[^0-9a-f-]/g, '')}'`),
          invoices: await select('SaleInvoice'),
          lines: await select('SaleInvoiceLine'),
          discounts: await select('Discount'),
          allocations: await select('DiscountAllocation'),
          payments: await select('Payment'),
          receipts: await select('Receipt'),
          ledger: await select('StockLedger', `"referenceType" = 'SALE'`),
          sequences: await tx.documentSequence.findMany({
            where: { kind: DocumentKind.INVOICE, series: documentSeries(counter.branch.code, counter.number, DocumentKind.INVOICE) }
          })
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
    );
    const by = <T extends Record<string, unknown>>(list: T[], key: string) => {
      const map = new Map<unknown, T[]>();
      for (const row of list) map.set(row[key], [...(map.get(row[key]) ?? []), row]);
      return (id: unknown) => map.get(id) ?? [];
    };
    const linesOf = by(lines, 'invoiceId');
    const discountsOf = by(discounts, 'saleInvoiceId');
    const allocationsOf = by(allocations, 'discountId');
    const paymentsOf = by(payments, 'invoiceId');
    const receiptsOf = by(receipts, 'invoiceId');
    const ledgerOf = by(ledger, 'referenceId');
    return {
      schemaVersion: (await appliedSchemaVersion(this.prisma)) ?? '',
      registers,
      invoices: invoices.map((invoice) => {
        const invoiceDiscounts = discountsOf(invoice.id);
        return {
          invoice,
          lines: linesOf(invoice.id),
          discounts: invoiceDiscounts,
          allocations: invoiceDiscounts.flatMap((discount) => allocationsOf(discount.id)),
          payments: paymentsOf(invoice.id),
          receipts: receiptsOf(invoice.id),
          ledger: ledgerOf(invoice.id)
        };
      }),
      sequences: sequences.map((sequence) => ({ kind: sequence.kind, series: sequence.series, fiscalYear: sequence.fiscalYear, lastSeq: sequence.lastSeq })),
      receiptSeq: counter.fallbackReceiptSeq
    };
  }
}
