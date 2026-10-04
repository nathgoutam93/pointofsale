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

/**
 * What a request may change while a fallback counter works offline (selling, credit, adding
 * customers, taking payment for and returning bills it has); everything else is read-only.
 */
const FALLBACK_WRITES = [
  /^POST \/auth\/log(in|out)$/,
  /^POST \/registers\/(open|close)$/,
  /^POST \/sales\/checkout$/,
  /^POST \/sales\/[0-9a-f-]{36}\/(settle|return)$/,
  /^POST \/customers$/,
  /^POST \/fallback\/numbers$/
];

export function isFallbackWrite(method: string, path: string) {
  return FALLBACK_WRITES.some((pattern) => pattern.test(`${method} ${path}`));
}

const rowsOf = (rows: Array<{ row: Record<string, unknown> }>) => rows.map((entry) => entry.row);

/**
 * A fallback counter's local copy: everything made while working offline, for the desktop app
 * to send to the server: every invoice and return except those that came with the copy
 * (FallbackCopiedDocument), and the customers added offline.
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
   * Before selling offline: the last invoice and return numbers the app saw this counter issue
   * online (after the copy was made), so offline ones carry on after them. Numbers of other
   * series are ignored; a number lower than the copy's changes nothing.
   */
  @Public()
  @Post('/fallback/numbers')
  @HttpCode(200)
  async numbers(@Headers() headers: RequestHeaders, @Body() body: { invoiceNumbers?: unknown }) {
    const counterId = this.assertApp(headers);
    const counter = await this.prisma.counter.findUniqueOrThrow({ where: { id: counterId }, select: { number: true, branch: { select: { code: true } } } });
    const seriesOf = [DocumentKind.INVOICE, DocumentKind.RETURN].map((kind) => ({ kind, series: documentSeries(counter.branch.code, counter.number, kind) }));
    let moved = 0;
    for (const documentNo of Array.isArray(body?.invoiceNumbers) ? body.invoiceNumbers : []) {
      if (typeof documentNo !== 'string') continue;
      // {series}/{YY}/{number}
      const own = seriesOf.find(({ series }) => documentNo.startsWith(`${series}/`));
      const match = own ? /^(\d{2})\/(\d+)$/.exec(documentNo.slice(own.series.length + 1)) : null;
      if (!own || !match) continue;
      const fiscalYear = 2000 + Number(match[1]);
      moved += await this.prisma.$executeRaw`
        INSERT INTO "DocumentSequence" ("kind", "series", "fiscalYear", "lastSeq")
        VALUES (${own.kind}::"DocumentKind", ${own.series}, ${fiscalYear}, ${Number(match[2])})
        ON CONFLICT ("kind", "series", "fiscalYear") DO UPDATE SET "lastSeq" = GREATEST("DocumentSequence"."lastSeq", EXCLUDED."lastSeq")`;
    }
    return { moved };
  }

  /**
   * The item pictures the copy's screens show (paths under /uploads/). The desktop app keeps
   * them in a folder of its own, fetched once from the server, since each refresh of the copy
   * replaces its uploads.
   */
  @Public()
  @Get('/fallback/images')
  async images(@Headers() headers: RequestHeaders) {
    this.assertApp(headers);
    const items = await this.prisma.item.findMany({ where: { imageUrl: { startsWith: '/uploads/' } }, select: { imageUrl: true }, distinct: ['imageUrl'] });
    return { paths: items.map((item) => item.imageUrl!).filter((path) => !path.includes('..')) };
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
    const { registers, invoices, lines, discounts, allocations, payments, receipts, ledger, sequences, customers, returns, returnLines, returnLedger } = await this.prisma.$transaction(
      async (tx) => {
        const select = async (table: string, where = 'true') =>
          rowsOf(await tx.$queryRawUnsafe<Array<{ row: Record<string, unknown> }>>(`SELECT row_to_json(t) AS row FROM "${table}" t WHERE ${where}`));
        return {
          registers: await select('RegisterSession', `"counterId" = '${counterId.replace(/[^0-9a-f-]/g, '')}'`),
          invoices: await select('SaleInvoice', `"id" NOT IN (SELECT "id" FROM "FallbackCopiedDocument")`),
          lines: await select('SaleInvoiceLine'),
          discounts: await select('Discount'),
          allocations: await select('DiscountAllocation'),
          payments: await select('Payment'),
          receipts: await select('Receipt'),
          ledger: await select('StockLedger', `"referenceType" = 'SALE'`),
          customers: await select('Customer', `"code" ~ '^OFF-[0-9A-F]{8}$'`),
          returns: await select('ReturnInvoice', `"id" NOT IN (SELECT "id" FROM "FallbackCopiedDocument")`),
          returnLines: await select('ReturnInvoiceLine'),
          returnLedger: await select('StockLedger', `"referenceType" = 'RETURN'`),
          sequences: await tx.documentSequence.findMany({
            where: {
              OR: [DocumentKind.INVOICE, DocumentKind.RETURN].map((kind) => ({ kind, series: documentSeries(counter.branch.code, counter.number, kind) }))
            }
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
    const returnLinesOf = by(returnLines, 'returnInvoiceId');
    const returnLedgerOf = by(returnLedger, 'referenceId');
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
      receiptSeq: counter.fallbackReceiptSeq,
      customers,
      returns: returns.map((ret) => ({ ret, lines: returnLinesOf(ret.id), ledger: returnLedgerOf(ret.id) }))
    };
  }
}
