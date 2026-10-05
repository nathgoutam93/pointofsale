import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DocumentKind, InvoiceStatus, PaymentMode, Prisma, StockTxnType, UserRole, WalletTxnType } from '@prisma/client';
import { invoiceDue, returnLineAmounts, splitReturn, type GstAmounts } from '@pos/contracts';
import { PrismaService } from '../prisma.service';
import type { SessionUser } from '../common/types';
import { toNumber, round2, round3 } from '../common/numbers';
import { assertQtyRespectsLeastCount } from '../common/quantities';
import { requireSessionBranchId } from '../common/session';
import { SequenceService } from '../sequences/sequences.service';
import { StockService } from '../stock/stock.service';
import { putBack } from '../stock/batches';
import { sharesOfLines } from '../stock/batch-stock';
import { CustomersService, walletTxnAuthor } from '../customers/customers.service';
import { RegistersService } from '../registers/registers.service';
import { isFallback } from '../common/mode';
import { localDate } from '../reports/zoned-dates';
import { afterCursor, newestFirst, type PageQuery } from '../common/paging';
import { AuditService } from '../common/audit.service';

type StoredGstAmounts = {
  taxableAmount: Prisma.Decimal | number;
  cgstAmount: Prisma.Decimal | number;
  sgstAmount: Prisma.Decimal | number;
  igstAmount: Prisma.Decimal | number;
};

/** A sale or return line's taxable value and tax parts, as numbers. */
function gstAmountsOf(row: StoredGstAmounts): GstAmounts {
  return {
    taxable: toNumber(row.taxableAmount),
    cgst: toNumber(row.cgstAmount),
    sgst: toNumber(row.sgstAmount),
    igst: toNumber(row.igstAmount)
  };
}

/** Calendar days from `from` to `to` in `timeZone` (0 on the same day). */
function calendarDaysBetween(from: Date, to: Date, timeZone: string) {
  const dayNumber = (at: Date) => {
    const { year, month, day } = localDate(at, timeZone);
    return Date.UTC(year, month - 1, day) / 86_400_000;
  };
  return dayNumber(to) - dayNumber(from);
}

function sumGstAmounts(rows: GstAmounts[]): GstAmounts {
  return rows.reduce(
    (acc, row) => ({
      taxable: round2(acc.taxable + row.taxable),
      cgst: round2(acc.cgst + row.cgst),
      sgst: round2(acc.sgst + row.sgst),
      igst: round2(acc.igst + row.igst)
    }),
    { taxable: 0, cgst: 0, sgst: 0, igst: 0 }
  );
}

@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: SequenceService,
    private readonly stock: StockService,
    private readonly customers: CustomersService,
    private readonly registers: RegistersService,
    private readonly audit: AuditService
  ) {}

  async createReturn(
    session: SessionUser,
    saleInvoiceId: string,
    input: { lines: Array<{ saleLineId: string; qty: number }>; refundMode: 'CASH' | 'WALLET'; reason: string }
  ) {
    const sessionBranchId = requireSessionBranchId(session);
    return this.prisma.$transaction(async (tx) => {
      if (input.refundMode !== PaymentMode.CASH && input.refundMode !== PaymentMode.WALLET) {
        throw new BadRequestException('Return refund mode must be CASH or WALLET');
      }
      const reason = input.reason?.trim() ?? '';
      if (reason.length < 3) {
        throw new BadRequestException('Say why the goods came back');
      }
      const author = await tx.user.findUnique({ where: { id: session.userId }, select: { username: true } });
      if (!author) throw new NotFoundException('User not found');

      // Lock the invoice so two returns against it can't both pass the quantity checks.
      await tx.$queryRaw`SELECT id FROM "SaleInvoice" WHERE id = ${saleInvoiceId} FOR UPDATE`;
      const invoice = await tx.saleInvoice.findUnique({
        where: { id: saleInvoiceId },
        include: {
          lines: { include: { returnLines: true } },
          returns: { select: { totalAmount: true, refundAmount: true } },
          customer: { select: { isWalkIn: true } },
          branch: { select: { name: true } }
        }
      });

      if (!invoice) throw new NotFoundException('Invoice not found');
      // Goods come back only where they were sold: into that branch's stock and drawer, on a
      // credit note under the GSTIN of the original invoice.
      if (invoice.branchId !== sessionBranchId) {
        throw new ForbiddenException(`Bill ${invoice.invoiceNo} was made at ${invoice.branch.name}: returns are taken only at the branch that sold the goods`);
      }
      if (invoice.status === InvoiceStatus.CANCELLED) {
        throw new BadRequestException(`Invoice ${invoice.invoiceNo} is cancelled`);
      }
      // Past the business's return window only an admin may take goods back.
      if (session.role !== UserRole.ADMIN) {
        const business = await tx.businessSettings.findUnique({ where: { id: 'default' }, select: { returnWindowDays: true, timezone: true } });
        const windowDays = business?.returnWindowDays;
        if (windowDays !== null && windowDays !== undefined) {
          const age = calendarDaysBetween(invoice.createdAt, new Date(), business?.timezone ?? 'Asia/Kolkata');
          if (age > windowDays) {
            throw new BadRequestException(
              `${invoice.invoiceNo} is ${age} days old; cashiers can take goods back within ${windowDays === 0 ? 'the same day' : `${windowDays} ${windowDays === 1 ? 'day' : 'days'}`}. Ask an admin.`
            );
          }
        }
      }

      // Add up repeated lines so the same sale line can't be counted twice.
      const requestedQtyByLine = new Map<string, number>();
      for (const reqLine of input.lines) {
        requestedQtyByLine.set(
          reqLine.saleLineId,
          round3((requestedQtyByLine.get(reqLine.saleLineId) ?? 0) + reqLine.qty)
        );
      }

      const returnLineCreates: Array<{
        id: string;
        saleLineId: string;
        qty: number;
        amount: number;
        taxableAmount: number;
        taxAmount: number;
        cgstAmount: number;
        sgstAmount: number;
        igstAmount: number;
      }> = [];
      const itemIds = Array.from(new Set(invoice.lines.map((line) => line.itemId)));
      const itemLeastCounts = new Map<string, number>();
      if (itemIds.length > 0) {
        const saleItems = await tx.item.findMany({
          where: { id: { in: itemIds } },
          select: { id: true, leastCount: true }
        });
        for (const saleItem of saleItems) {
          itemLeastCounts.set(saleItem.id, toNumber(saleItem.leastCount));
        }
      }

      for (const [saleLineId, qty] of requestedQtyByLine) {
        const saleLine = invoice.lines.find((l) => l.id === saleLineId);
        if (!saleLine) throw new BadRequestException(`Sale line not found: ${saleLineId}`);
        const leastCount = itemLeastCounts.get(saleLine.itemId) ?? 1;
        assertQtyRespectsLeastCount(qty, leastCount, `Return line ${saleLine.id}`);

        const alreadyReturned = round3(saleLine.returnLines.reduce((acc, rl) => acc + toNumber(rl.qty), 0));
        const soldQty = toNumber(saleLine.qty);
        if (alreadyReturned + qty > soldQty + 1e-9) {
          throw new BadRequestException(`Return qty exceeds sold qty for line ${saleLine.id}`);
        }

        // Shared with the Returns page so the amount shown is the amount refunded.
        const refund = returnLineAmounts({
          line: gstAmountsOf(saleLine),
          soldQty,
          alreadyReturnedQty: alreadyReturned,
          alreadyReturned: sumGstAmounts(saleLine.returnLines.map(gstAmountsOf)),
          qty
        });
        returnLineCreates.push({
          id: randomUUID(),
          saleLineId: saleLine.id,
          qty,
          amount: refund.amount,
          taxableAmount: refund.taxable,
          taxAmount: refund.tax,
          cgstAmount: refund.cgst,
          sgstAmount: refund.sgst,
          igstAmount: refund.igst
        });
      }
      const total = (pick: (line: (typeof returnLineCreates)[number]) => number) =>
        round2(returnLineCreates.reduce((acc, line) => acc + pick(line), 0));
      const totalAmount = total((line) => line.amount);

      // A bill not yet paid in full is brought down first (a credit sale returned in full owes
      // nothing and gets nothing back); only what is left over is handed back.
      const grandTotal = toNumber(invoice.grandTotal);
      const paidTotal = toNumber(invoice.paidTotal);
      const creditedTotal = toNumber(invoice.creditedTotal);
      const { dueAdjusted, refundAmount } = splitReturn(totalAmount, invoiceDue({ grandTotal, paidTotal, creditedTotal }));
      // Never refund more than the customer paid for this invoice in total.
      const refundedBefore = round2(invoice.returns.reduce((acc, r) => acc + toNumber(r.refundAmount), 0));
      if (refundAmount > round2(Math.min(paidTotal, grandTotal) - refundedBefore) + 1e-9) {
        throw new BadRequestException('Refund would be more than was paid for this invoice');
      }
      if (refundAmount > 0 && input.refundMode === PaymentMode.WALLET) {
        this.customers.assertHasWallet(invoice.customer);
        if (isFallback()) throw new BadRequestException("While working offline, refunds are in cash: the wallet needs the server.");
      }
      if (dueAdjusted > 0) {
        const credited = round2(creditedTotal + dueAdjusted);
        await tx.saleInvoice.update({
          where: { id: invoice.id },
          data: {
            creditedTotal: credited,
            status: round2(paidTotal + credited) >= grandTotal ? InvoiceStatus.SETTLED : InvoiceStatus.PARTIALLY_SETTLED
          }
        });
      }

      // Numbered in the series of the counter giving the refund.
      const { counterId } = await this.registers.assertRegisterOpen(tx, session);
      const { number: returnNo, series: documentSeries, fiscalYear } = await this.sequences.nextDocumentNumber(
        tx,
        counterId,
        DocumentKind.RETURN
      );
      const returnInvoice = await tx.returnInvoice.create({
        data: {
          saleInvoiceId,
          returnNo,
          documentSeries,
          fiscalYear,
          totalAmount,
          taxableTotal: total((line) => line.taxableAmount),
          taxTotal: total((line) => line.taxAmount),
          cgstTotal: total((line) => line.cgstAmount),
          sgstTotal: total((line) => line.sgstAmount),
          igstTotal: total((line) => line.igstAmount),
          dueAdjusted,
          refundAmount,
          refundMode: input.refundMode,
          reason,
          createdBy: session.userId,
          createdByName: author.username,
          registerSessionId: session.registerId,
          lines: { create: returnLineCreates }
        }
      });

      // Back into the batches the sale line took, less what earlier returns put back.
      const saleLineIds = returnLineCreates.map((line) => line.saleLineId);
      const earlierReturnLines = invoice.lines.filter((line) => saleLineIds.includes(line.id)).flatMap((line) => line.returnLines.map((returned) => ({ id: returned.id, saleLineId: line.id })));
      const sold = await sharesOfLines(tx, saleLineIds, 'OUT');
      const putBackEarlier = await sharesOfLines(tx, earlierReturnLines.map((line) => line.id), 'IN');
      await this.stock.recordStock(
        tx,
        returnLineCreates.flatMap((line) => {
          const out = sold.get(line.saleLineId) ?? [];
          const back = earlierReturnLines.filter((earlier) => earlier.saleLineId === line.saleLineId).flatMap((earlier) => putBackEarlier.get(earlier.id) ?? []);
          return putBack(out, back, line.qty).map((share) => ({
            branchId: invoice.branchId,
            itemId: invoice.lines.find((l) => l.id === line.saleLineId)!.itemId,
            txnType: StockTxnType.RETURN,
            qtyIn: share.qty,
            qtyOut: 0,
            referenceType: 'RETURN',
            referenceId: returnInvoice.id,
            lineId: line.id,
            batchId: share.batchId
          }));
        })
      );

      if (refundAmount > 0 && input.refundMode === PaymentMode.WALLET) {
        const wallet = await tx.walletAccount.findUnique({ where: { customerId: invoice.customerId } });
        if (!wallet) throw new NotFoundException('Wallet not found');

        await tx.walletAccount.update({ where: { id: wallet.id }, data: { balance: { increment: refundAmount } } });
        await tx.walletTxn.create({
          data: {
            walletAccountId: wallet.id,
            type: WalletTxnType.REFUND_RETURN,
            amount: refundAmount,
            referenceType: 'RETURN',
            referenceId: returnInvoice.id,
            ...(await walletTxnAuthor(tx, session))
          }
        });
      }

      await this.audit.record(
        session,
        {
          action: 'RETURN_MADE',
          entityType: 'ReturnInvoice',
          entityId: returnInvoice.id,
          branchId: invoice.branchId,
          summary: `Return ${returnNo} on ${invoice.invoiceNo}: ${totalAmount.toFixed(2)}${refundAmount > 0 ? `, ${refundAmount.toFixed(2)} back in ${input.refundMode.toLowerCase()}` : ''} (${reason})`,
          details: { returnNo, invoiceNo: invoice.invoiceNo, totalAmount, refundAmount, dueAdjusted, refundMode: input.refundMode, reason }
        },
        tx
      );
      return returnInvoice;
    });
  }

  /** A page of the branch's returns, newest first. */
  async listReturns(branchId: string, filters: PageQuery & { search?: string } = { limit: 100 }) {
    const search = filters.search?.trim();
    const returns = await this.prisma.returnInvoice.findMany({
      where: {
        saleInvoice: { branchId },
        ...afterCursor(filters),
        ...(search
          ? {
              AND: [
                {
                  OR: [
                    { returnNo: { contains: search, mode: 'insensitive' as const } },
                    { saleInvoice: { invoiceNo: { contains: search, mode: 'insensitive' as const } } },
                    { saleInvoice: { customerName: { contains: search, mode: 'insensitive' as const } } }
                  ]
                }
              ]
            }
          : {})
      },
      take: filters.limit,
      include: {
        saleInvoice: {
          select: {
            invoiceNo: true,
            customer: {
              select: { name: true }
            }
          }
        },
        lines: { select: { id: true } }
      },
      orderBy: newestFirst
    });

    return returns.map((row) => ({
      id: row.id,
      saleInvoiceId: row.saleInvoiceId,
      returnNo: row.returnNo,
      totalAmount: row.totalAmount,
      dueAdjusted: row.dueAdjusted,
      refundAmount: row.refundAmount,
      refundMode: row.refundMode,
      reason: row.reason,
      createdByName: row.createdByName,
      createdAt: row.createdAt,
      saleInvoiceNo: row.saleInvoice.invoiceNo,
      customerName: row.saleInvoice.customer.name,
      lineCount: row.lines.length
    }));
  }

  /** The branch a return was made at (its bill's); null when there is none. */
  async branchOf(id: string) {
    const row = await this.prisma.returnInvoice.findUnique({ where: { id }, select: { saleInvoice: { select: { branchId: true } } } });
    return row?.saleInvoice.branchId ?? null;
  }

  async getReturnById(branchId: string, id: string) {
    const returnInvoice = await this.prisma.returnInvoice.findUnique({
      where: { id },
      include: {
        saleInvoice: {
          include: {
            customer: { select: { name: true } }
          }
        },
        lines: {
          include: {
            saleLine: {
              include: {
                item: { select: { id: true, name: true } }
              }
            }
          }
        }
      }
    });

    if (!returnInvoice) throw new NotFoundException('Return invoice not found');
    if (returnInvoice.saleInvoice.branchId !== branchId) throw new NotFoundException('Return invoice not found');

    return {
      id: returnInvoice.id,
      saleInvoiceId: returnInvoice.saleInvoiceId,
      returnNo: returnInvoice.returnNo,
      totalAmount: returnInvoice.totalAmount,
      taxableTotal: returnInvoice.taxableTotal,
      taxTotal: returnInvoice.taxTotal,
      cgstTotal: returnInvoice.cgstTotal,
      sgstTotal: returnInvoice.sgstTotal,
      igstTotal: returnInvoice.igstTotal,
      dueAdjusted: returnInvoice.dueAdjusted,
      refundAmount: returnInvoice.refundAmount,
      refundMode: returnInvoice.refundMode,
      reason: returnInvoice.reason,
      createdByName: returnInvoice.createdByName,
      createdAt: returnInvoice.createdAt,
      saleInvoiceNo: returnInvoice.saleInvoice.invoiceNo,
      customerName: returnInvoice.saleInvoice.customer.name,
      lines: returnInvoice.lines.map((line) => ({
        id: line.id,
        saleLineId: line.saleLineId,
        itemId: line.saleLine.item.id,
        itemName: line.saleLine.item.name,
        qty: line.qty,
        amount: line.amount,
        taxableAmount: line.taxableAmount,
        taxAmount: line.taxAmount,
        cgstAmount: line.cgstAmount,
        sgstAmount: line.sgstAmount,
        igstAmount: line.igstAmount
      }))
    };
  }
}
