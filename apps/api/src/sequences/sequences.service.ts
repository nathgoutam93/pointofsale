import { Injectable, Logger } from '@nestjs/common';
import { DocumentKind, Prisma } from '@prisma/client';
import { documentNumber, documentSeriesCandidates, financialYearStart, GST_DOCUMENT_NUMBER_MAX_LENGTH } from '@pos/contracts';
import { PrismaService } from '../prisma.service';
import { localDate } from '../reports/zoned-dates';

@Injectable()
export class SequenceService {
  constructor(
    private readonly prisma: PrismaService
  ) {}

  private readonly logger = new Logger(SequenceService.name);

  /**
   * The next GST invoice or credit note number for a branch: {series}/{FY}/{number}, from
   * the branch's series, counting from 1 in each financial year (April to March, in the
   * business time zone). The count is kept per series, so it is atomic across branches.
   */
  async nextDocumentNumber(tx: Prisma.TransactionClient, branchId: string, kind: DocumentKind) {
    const branch = await tx.branch.findUniqueOrThrow({
      where: { id: branchId },
      select: { invoicePrefix: true, returnPrefix: true }
    });
    const business = await tx.businessSettings.findUnique({ where: { id: 'default' }, select: { timezone: true } });
    const today = localDate(new Date(), business?.timezone ?? 'Asia/Kolkata');
    const fiscalYear = financialYearStart(today.year, today.month);
    const series = kind === DocumentKind.INVOICE ? branch.invoicePrefix : branch.returnPrefix;

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

  /** Receipt and customer numbers (not GST documents): one running count per branch. */
  async nextSequence(branchId: string, type: 'receipt' | 'customer', tx: Prisma.TransactionClient) {
    const field = type === 'receipt' ? 'receiptSeq' : 'customerSeq';
    const branch = await tx.branch.update({
      where: { id: branchId },
      data: { [field]: { increment: 1 } },
      select: { code: true, receiptSeq: true, customerSeq: true, receiptPrefix: true }
    });
    return {
      branchCode: branch.code,
      seq: type === 'receipt' ? branch.receiptSeq : branch.customerSeq,
      prefix: type === 'receipt' ? branch.receiptPrefix : 'CUST'
    };
  }

  /** Invoice and credit note series for a new branch: from its code, the first ones free. */
  async freeDocumentSeries(tx: Prisma.TransactionClient, branchCode: string) {
    // Two branches created at once must not both take the same series.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('document-series'))`;
    const taken = await tx.branch.findMany({ select: { invoicePrefix: true, returnPrefix: true } });
    const pick = (candidates: string[], used: Set<string>, fallback: string) => {
      const free = candidates.find((series) => !used.has(series));
      if (free) return free;
      for (let n = 1; ; n++) {
        const series = `${fallback}${String(n).padStart(4, '0')}`;
        if (!used.has(series)) return series;
      }
    };
    return {
      invoicePrefix: pick(documentSeriesCandidates(branchCode), new Set(taken.map((b) => b.invoicePrefix)), 'X'),
      returnPrefix: pick(documentSeriesCandidates(branchCode, 'R'), new Set(taken.map((b) => b.returnPrefix)), 'R')
    };
  }
}
