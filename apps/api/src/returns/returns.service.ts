import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, PaymentMode, Prisma, StockTxnType, WalletTxnType } from '@prisma/client';
import { returnLineAmounts, type GstAmounts } from '@pos/contracts';
import { PrismaService } from '../prisma.service';
import type { SessionUser } from '../common/types';
import { toNumber, round2, round3 } from '../common/numbers';
import { assertQtyRespectsLeastCount } from '../common/quantities';
import { requireSessionBranchId } from '../common/session';
import { SequenceService } from '../sequences/sequences.service';
import { StockService } from '../stock/stock.service';
import { CustomersService } from '../customers/customers.service';
import { RegistersService } from '../registers/registers.service';

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
    private readonly registers: RegistersService
  ) {}

  async createReturn(
    session: SessionUser,
    saleInvoiceId: string,
    input: { lines: Array<{ saleLineId: string; qty: number }>; refundMode: 'CASH' | 'WALLET' }
  ) {
    const sessionBranchId = requireSessionBranchId(session);
    return this.prisma.$transaction(async (tx) => {
      if (input.refundMode !== PaymentMode.CASH && input.refundMode !== PaymentMode.WALLET) {
        throw new BadRequestException('Return refund mode must be CASH or WALLET');
      }

      // Lock the invoice so two returns against it can't both pass the quantity checks.
      await tx.$queryRaw`SELECT id FROM "SaleInvoice" WHERE id = ${saleInvoiceId} FOR UPDATE`;
      const invoice = await tx.saleInvoice.findUnique({
        where: { id: saleInvoiceId },
        include: {
          lines: { include: { returnLines: true } },
          returns: { select: { totalAmount: true } },
          customer: { select: { isWalkIn: true } }
        }
      });

      if (!invoice) throw new NotFoundException('Invoice not found');
      if (invoice.branchId !== sessionBranchId) throw new BadRequestException('Branch mismatch');
      // Only paid invoices can be returned; refunding an unpaid or part-paid sale would
      // hand back money that was never taken.
      if (invoice.status !== InvoiceStatus.SETTLED) {
        throw new BadRequestException(
          invoice.status === InvoiceStatus.CANCELLED
            ? `Invoice ${invoice.invoiceNo} is cancelled`
            : `Invoice ${invoice.invoiceNo} isn't fully paid yet. Collect the payment before returning items.`
        );
      }

      if (input.refundMode === PaymentMode.WALLET) {
        this.customers.assertHasWallet(invoice.customer);
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

      // Never refund more than the customer paid for this invoice in total.
      const refundedBefore = round2(invoice.returns.reduce((acc, r) => acc + toNumber(r.totalAmount), 0));
      const paidForGoods = Math.min(toNumber(invoice.paidTotal), toNumber(invoice.grandTotal));
      if (totalAmount > round2(paidForGoods - refundedBefore) + 1e-9) {
        throw new BadRequestException('Refund would be more than was paid for this invoice');
      }

      const seq = await this.sequences.nextSequence(invoice.branchId, 'return', tx);
      const returnNo = `${seq.prefix}-${seq.branchCode}-${String(seq.seq).padStart(6, '0')}`;

      await this.registers.assertRegisterOpen(tx, session);
      const returnInvoice = await tx.returnInvoice.create({
        data: {
          saleInvoiceId,
          returnNo,
          totalAmount,
          taxableTotal: total((line) => line.taxableAmount),
          taxTotal: total((line) => line.taxAmount),
          cgstTotal: total((line) => line.cgstAmount),
          sgstTotal: total((line) => line.sgstAmount),
          igstTotal: total((line) => line.igstAmount),
          refundMode: input.refundMode,
          registerSessionId: session.registerId,
          lines: { create: returnLineCreates }
        }
      });

      await this.stock.recordStock(
        tx,
        returnLineCreates.map((line) => ({
          branchId: invoice.branchId,
          itemId: invoice.lines.find((l) => l.id === line.saleLineId)!.itemId,
          txnType: StockTxnType.RETURN,
          qtyIn: line.qty,
          qtyOut: 0,
          referenceType: 'RETURN',
          referenceId: returnInvoice.id
        }))
      );

      if (input.refundMode === PaymentMode.WALLET) {
        const wallet = await tx.walletAccount.findUnique({ where: { customerId: invoice.customerId } });
        if (!wallet) throw new NotFoundException('Wallet not found');

        await tx.walletAccount.update({ where: { id: wallet.id }, data: { balance: { increment: totalAmount } } });
        await tx.walletTxn.create({
          data: {
            walletAccountId: wallet.id,
            type: WalletTxnType.REFUND_RETURN,
            amount: totalAmount,
            referenceType: 'RETURN',
            referenceId: returnInvoice.id
          }
        });
      }

      return returnInvoice;
    });
  }

  async listReturns(branchId: string) {
    const returns = await this.prisma.returnInvoice.findMany({
      where: { saleInvoice: { branchId } },
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
      orderBy: { createdAt: 'desc' }
    });

    return returns.map((row) => ({
      id: row.id,
      saleInvoiceId: row.saleInvoiceId,
      returnNo: row.returnNo,
      totalAmount: row.totalAmount,
      refundMode: row.refundMode,
      createdAt: row.createdAt,
      saleInvoiceNo: row.saleInvoice.invoiceNo,
      customerName: row.saleInvoice.customer.name,
      lineCount: row.lines.length
    }));
  }

  async getReturnById(session: SessionUser, id: string) {
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
    const sessionBranchId = requireSessionBranchId(session);
    if (returnInvoice.saleInvoice.branchId !== sessionBranchId) throw new BadRequestException('Branch mismatch');

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
      refundMode: returnInvoice.refundMode,
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
