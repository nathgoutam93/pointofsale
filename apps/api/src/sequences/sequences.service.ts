import { Injectable, Logger } from '@nestjs/common';
import { DocumentKind, Prisma } from '@prisma/client';
import { documentNumber, documentSeries, financialYearStart, GST_DOCUMENT_NUMBER_MAX_LENGTH } from '@pos/contracts';
import { PrismaService } from '../prisma.service';
import { fallbackCounterId, isFallback } from '../common/mode';
import { localDate } from '../reports/zoned-dates';

const SEQUENCE_FIELDS = {
  receipt: 'receiptSeq',
  customer: 'customerSeq',
  purchase: 'purchaseSeq',
  transfer: 'transferSeq'
} as const;

const SEQUENCE_PREFIXES = { customer: 'CUST', purchase: 'PUR', transfer: 'TRF' } as const;

@Injectable()
export class SequenceService {
  constructor(
    private readonly prisma: PrismaService
  ) {}

  private readonly logger = new Logger(SequenceService.name);

  /**
   * The next GST invoice or credit note number for a counter: {series}/{YY}/{number}, where
   * the series is the branch code and counter number (MAI/1, MAIR/1 for credit notes),
   * counting from 1 in each financial year (April to March, in the business time zone).
   */
  async nextDocumentNumber(tx: Prisma.TransactionClient, counterId: string, kind: DocumentKind) {
    const counter = await tx.counter.findUniqueOrThrow({
      where: { id: counterId },
      select: { number: true, branch: { select: { code: true } } }
    });
    const business = await tx.businessSettings.findUnique({ where: { id: 'default' }, select: { timezone: true } });
    const today = localDate(new Date(), business?.timezone ?? 'Asia/Kolkata');
    const fiscalYear = financialYearStart(today.year, today.month);
    const series = documentSeries(counter.branch.code, counter.number, kind);

    const [{ lastSeq }] = await tx.$queryRaw<Array<{ lastSeq: number }>>`
      INSERT INTO "DocumentSequence" ("kind", "series", "fiscalYear", "lastSeq")
      VALUES (${kind}::"DocumentKind", ${series}, ${fiscalYear}, 1)
      ON CONFLICT ("kind", "series", "fiscalYear")
      DO UPDATE SET "lastSeq" = "DocumentSequence"."lastSeq" + 1
      RETURNING "lastSeq"`;
    const number = documentNumber(series, fiscalYear, lastSeq);
    if (number.length > GST_DOCUMENT_NUMBER_MAX_LENGTH) {
      // Only past 99,999 documents in a year; the sale still goes through.
      this.logger.warn(`${number} is longer than GST's ${GST_DOCUMENT_NUMBER_MAX_LENGTH} characters; start a new series`);
    }
    return { number, series, fiscalYear };
  }

  /** Receipt, customer, purchase and transfer numbers (not GST documents): one running count per branch. */
  async nextSequence(branchId: string, type: 'receipt' | 'customer' | 'purchase' | 'transfer', tx: Prisma.TransactionClient) {
    // A fallback counter working offline has a receipt series of its own (RCPT-MAI-F1-000001),
    // which the branch's other tills, still online, never use.
    const fallbackCounter = fallbackCounterId();
    if (type === 'receipt' && isFallback() && fallbackCounter) {
      const counter = await tx.counter.update({
        where: { id: fallbackCounter },
        data: { fallbackReceiptSeq: { increment: 1 } },
        select: { number: true, fallbackReceiptSeq: true, branch: { select: { code: true, receiptPrefix: true } } }
      });
      return { branchCode: `${counter.branch.code}-F${counter.number}`, seq: counter.fallbackReceiptSeq, prefix: counter.branch.receiptPrefix };
    }
    const field = SEQUENCE_FIELDS[type];
    const branch = await tx.branch.update({
      where: { id: branchId },
      data: { [field]: { increment: 1 } },
      select: { code: true, receiptSeq: true, customerSeq: true, purchaseSeq: true, transferSeq: true, receiptPrefix: true }
    });
    return {
      branchCode: branch.code,
      seq: branch[field],
      prefix: type === 'receipt' ? branch.receiptPrefix : SEQUENCE_PREFIXES[type]
    };
  }
}
