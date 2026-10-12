import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StockTxnType } from '@prisma/client';
import { returnLineAmounts, type GstAmounts } from '@pos/contracts';
import { AuditService } from '../common/audit.service';
import { round2, round3, toNumber } from '../common/numbers';
import { afterCursor, newestFirst, type PageQuery } from '../common/paging';
import { assertQtyRespectsLeastCount } from '../common/quantities';
import type { SessionUser } from '../common/types';
import { PrismaService } from '../prisma.service';
import { SequenceService } from '../sequences/sequences.service';
import { StockService } from '../stock/stock.service';

export const purchaseReturnInclude = {
  purchase: { select: { purchaseNo: true, supplierName: true } },
  lines: { include: { item: { select: { code: true, name: true, uom: true } } } }
} satisfies Prisma.PurchaseReturnInclude;

type PurchaseReturnRow = Prisma.PurchaseReturnGetPayload<{ include: typeof purchaseReturnInclude }>;

const gstOf = (row: { amount: Prisma.Decimal | number; cgstAmount: Prisma.Decimal | number; sgstAmount: Prisma.Decimal | number; igstAmount: Prisma.Decimal | number }): GstAmounts => ({
  taxable: toNumber(row.amount),
  cgst: toNumber(row.cgstAmount),
  sgst: toNumber(row.sgstAmount),
  igst: toNumber(row.igstAmount)
});

/** A purchase return as the API answers it. */
export function purchaseReturnView(row: PurchaseReturnRow) {
  const { purchase, ...rest } = row;
  return {
    ...rest,
    purchaseNo: purchase.purchaseNo,
    supplierName: purchase.supplierName,
    taxableTotal: toNumber(row.taxableTotal),
    cgstTotal: toNumber(row.cgstTotal),
    sgstTotal: toNumber(row.sgstTotal),
    igstTotal: toNumber(row.igstTotal),
    taxTotal: toNumber(row.taxTotal),
    totalAmount: toNumber(row.totalAmount),
    lines: row.lines.map((line) => ({
      ...line,
      qty: toNumber(line.qty),
      amount: toNumber(line.amount),
      taxRate: toNumber(line.taxRate),
      cgstAmount: toNumber(line.cgstAmount),
      sgstAmount: toNumber(line.sgstAmount),
      igstAmount: toNumber(line.igstAmount)
    }))
  };
}

/**
 * Goods sent back to the supplier of a purchase (a debit note). Each line's value and GST are
 * the purchase line's, prorated on the units sent back (returnLineAmounts, as for sales), so
 * sending a line back in steps adds up to it exactly. The goods leave the branch's stock, and
 * what the supplier is owed comes down by the total.
 */
@Injectable()
export class PurchaseReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: SequenceService,
    private readonly stock: StockService,
    private readonly audit: AuditService
  ) {}

  /** The branch a purchase was received at; null when there is none. */
  async branchOfPurchase(purchaseId: string) {
    const row = await this.prisma.purchase.findUnique({ where: { id: purchaseId }, select: { branchId: true } });
    return row?.branchId ?? null;
  }

  async createReturn(session: SessionUser, purchaseId: string, input: { lines: Array<{ purchaseLineId: string; qty: number }>; reason: string }) {
    return this.prisma.$transaction(async (tx) => {
      // Lock the purchase so two returns against it can't both pass the quantity checks.
      await tx.$queryRaw`SELECT id FROM "Purchase" WHERE id = ${purchaseId} FOR UPDATE`;
      const purchase = await tx.purchase.findUnique({
        where: { id: purchaseId },
        include: { lines: { include: { item: { select: { name: true, leastCount: true } }, returnLines: true } } }
      });
      if (!purchase) throw new NotFoundException('Purchase not found');

      const lines = input.lines.map((requested) => {
        const line = purchase.lines.find((entry) => entry.id === requested.purchaseLineId);
        if (!line) throw new BadRequestException(`That line isn't on purchase ${purchase.purchaseNo}`);
        assertQtyRespectsLeastCount(requested.qty, toNumber(line.item.leastCount), line.item.name);
        const qty = round3(requested.qty);
        const bought = toNumber(line.qty);
        const alreadyReturnedQty = round3(line.returnLines.reduce((sum, entry) => sum + toNumber(entry.qty), 0));
        if (alreadyReturnedQty + qty > bought + 1e-9) {
          throw new BadRequestException(`Only ${round3(bought - alreadyReturnedQty)} of ${line.item.name} can go back: ${bought} were bought, ${alreadyReturnedQty} already sent back`);
        }
        const alreadyReturned = line.returnLines.map(gstOf).reduce<GstAmounts>(
          (sum, entry) => ({ taxable: round2(sum.taxable + entry.taxable), cgst: round2(sum.cgst + entry.cgst), sgst: round2(sum.sgst + entry.sgst), igst: round2(sum.igst + entry.igst) }),
          { taxable: 0, cgst: 0, sgst: 0, igst: 0 }
        );
        const amounts = returnLineAmounts({ line: gstOf(line), soldQty: bought, alreadyReturnedQty, alreadyReturned, qty });
        return { line, qty, amounts };
      });

      // The goods must be here to send them back: of their batch, for items kept by batch.
      await this.stock.lockItemStock(tx, purchase.branchId, lines.map((entry) => entry.line.itemId));
      for (const entry of lines) {
        const onHand = entry.line.batchId
          ? toNumber((await tx.batchStock.findUnique({ where: { branchId_batchId: { branchId: purchase.branchId, batchId: entry.line.batchId } } }))?.qty)
          : await this.stock.getOnHandForItem(purchase.branchId, entry.line.itemId, tx);
        if (onHand + 1e-9 < entry.qty) {
          throw new BadRequestException(`Insufficient stock for ${entry.line.item.name}${entry.line.batchId ? ' in its batch' : ''}: ${round3(onHand)} on hand, ${entry.qty} to send back`);
        }
      }

      const user = await tx.user.findUnique({ where: { id: session.userId }, select: { username: true } });
      if (!user) throw new NotFoundException('User not found');
      const seq = await this.sequences.nextSequence(purchase.branchId, 'purchaseReturn', tx);
      const returnNo = `${seq.prefix}-${seq.branchCode}-${String(seq.seq).padStart(6, '0')}`;
      const sum = (pick: (entry: (typeof lines)[number]) => number) => round2(lines.reduce((acc, entry) => acc + pick(entry), 0));

      const created = await tx.purchaseReturn.create({
        data: {
          returnNo,
          purchaseId,
          branchId: purchase.branchId,
          supplierId: purchase.supplierId,
          reason: input.reason.trim(),
          taxableTotal: sum((entry) => entry.amounts.taxable),
          cgstTotal: sum((entry) => entry.amounts.cgst),
          sgstTotal: sum((entry) => entry.amounts.sgst),
          igstTotal: sum((entry) => entry.amounts.igst),
          taxTotal: sum((entry) => entry.amounts.tax),
          totalAmount: sum((entry) => entry.amounts.amount),
          itcReversed: purchase.itcEligible,
          createdBy: session.userId,
          createdByName: user.username,
          lines: {
            create: lines.map((entry) => ({
              purchaseLineId: entry.line.id,
              itemId: entry.line.itemId,
              qty: entry.qty,
              amount: entry.amounts.taxable,
              taxRate: entry.line.taxRate,
              cgstAmount: entry.amounts.cgst,
              sgstAmount: entry.amounts.sgst,
              igstAmount: entry.amounts.igst
            }))
          }
        },
        include: purchaseReturnInclude
      });

      await this.stock.recordStock(
        tx,
        lines.map((entry) => ({
          branchId: purchase.branchId,
          itemId: entry.line.itemId,
          txnType: StockTxnType.PURCHASE_RETURN,
          qtyIn: 0,
          qtyOut: entry.qty,
          costPrice: entry.line.unitCost,
          reason: `${returnNo} to ${purchase.supplierName}: ${input.reason.trim()}`,
          referenceType: 'PURCHASE_RETURN',
          referenceId: created.id,
          lineId: created.lines.find((line) => line.purchaseLineId === entry.line.id)?.id,
          batchId: entry.line.batchId
        }))
      );
      await this.audit.record(
        session,
        {
          action: 'PURCHASE_RETURNED',
          entityType: 'Purchase',
          entityId: purchaseId,
          branchId: purchase.branchId,
          summary: `Sent goods worth ${toNumber(created.totalAmount).toFixed(2)} back to ${purchase.supplierName} (${returnNo}, against ${purchase.purchaseNo}): ${input.reason.trim()}`,
          details: { returnId: created.id, returnNo, totalAmount: toNumber(created.totalAmount) }
        },
        tx
      );
      return purchaseReturnView(created);
    });
  }

  /** A page of a branch's purchase returns, newest first. */
  async listReturns(branchId: string, page: PageQuery) {
    const rows = await this.prisma.purchaseReturn.findMany({
      where: { branchId, ...afterCursor(page) },
      include: purchaseReturnInclude,
      orderBy: newestFirst,
      take: page.limit
    });
    return rows.map(purchaseReturnView);
  }
}
