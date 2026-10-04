import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StockTxnType } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { SessionUser } from '../common/types';
import { toNumber, round2, round3 } from '../common/numbers';
import { assertQtyRespectsLeastCount } from '../common/quantities';
import { BranchesService } from '../branches/branches.service';
import { SettingsService } from '../settings/settings.service';
import { SequenceService } from '../sequences/sequences.service';
import { StockService } from '../stock/stock.service';
import { chargesGst, splitGst } from '@pos/contracts';

export type CreatePurchaseInput = {
  branchId: string;
  supplierName: string;
  supplierGstin?: string;
  supplierInvoiceNo?: string;
  supplierInvoiceDate?: string;
  note?: string;
  lines: Array<{ itemId: string; qty: number; unitCost: number; taxRate?: number }>;
};

export const purchaseInclude = {
  lines: { include: { item: { select: { code: true, name: true, uom: true } } } }
} satisfies Prisma.PurchaseInclude;

/**
 * The item's cost after buying `qty` at `unitCost`: the average over the stock already on
 * hand at every branch (at the current cost) and the new stock. Stock below zero counts as none.
 */
export function weightedAverageCost(onHand: number, currentCost: number, qty: number, unitCost: number) {
  const held = Math.max(onHand, 0);
  return round2((held * currentCost + qty * unitCost) / (held + qty));
}

@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly branches: BranchesService,
    private readonly sequences: SequenceService,
    private readonly stock: StockService
  ) {}

  /** Records goods received at a branch: adds the stock and updates each item's cost. The caller checks who may. */
  async createPurchase(session: SessionUser, input: CreatePurchaseInput) {
    await this.settings.ensureBranchExists(input.branchId);

    return this.prisma.$transaction(async (tx) => {
      const itemIds = input.lines.map((line) => line.itemId);
      // Lock the items' rows so two purchases of an item can't both average from the same cost.
      await tx.$queryRaw`SELECT "id" FROM "Item" WHERE "id" IN (${Prisma.join([...itemIds].sort())}) ORDER BY "id" FOR UPDATE`;
      const items = await tx.item.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, name: true, leastCount: true, costPrice: true, taxRate: true }
      });
      // GST: only a registered supplier charges it; from the same state as CGST + SGST, from
      // another as IGST. It counts as input tax credit when bought under a GSTIN by a regular taxpayer.
      const supplierGstin = input.supplierGstin?.trim().toUpperCase() || null;
      const buyer = await this.settings.gstRegistrationFor(input.branchId, tx);
      const buyerState = buyer.stateCode ?? buyer.gstin?.slice(0, 2) ?? null;
      const interState = !!supplierGstin && !!buyerState && supplierGstin.slice(0, 2) !== buyerState;
      const { taxpayerType } = await this.settings.taxpayerTypeAt(new Date(), tx);
      const itcEligible = !!supplierGstin && !!buyer.gstin && chargesGst(taxpayerType);
      const itemsById = new Map(items.map((item) => [item.id, item]));

      const lines = input.lines.map((line) => {
        const item = itemsById.get(line.itemId);
        if (!item) throw new NotFoundException(`Item not found: ${line.itemId}`);
        assertQtyRespectsLeastCount(line.qty, toNumber(item.leastCount), item.name);
        const qty = round3(line.qty);
        const unitCost = round2(line.unitCost);
        const amount = round2(qty * unitCost);
        const taxRate = supplierGstin ? (line.taxRate ?? toNumber(item.taxRate)) : 0;
        const tax = round2((amount * taxRate) / 100);
        return { item, qty, unitCost, amount, taxRate, ...splitGst(tax, interState) };
      });
      const sum = (pick: (line: (typeof lines)[number]) => number) => round2(lines.reduce((acc, line) => acc + pick(line), 0));

      const user = await tx.user.findUnique({ where: { id: session.userId }, select: { username: true } });
      if (!user) throw new NotFoundException('User not found');
      const seq = await this.sequences.nextSequence(input.branchId, 'purchase', tx);
      const purchaseNo = `${seq.prefix}-${seq.branchCode}-${String(seq.seq).padStart(6, '0')}`;

      const purchase = await tx.purchase.create({
        data: {
          purchaseNo,
          branchId: input.branchId,
          supplierName: input.supplierName.trim(),
          supplierGstin,
          supplierInvoiceNo: input.supplierInvoiceNo?.trim() || null,
          supplierInvoiceDate: input.supplierInvoiceDate || null,
          note: input.note?.trim() || null,
          totalCost: sum((line) => line.amount),
          buyerGstin: buyer.gstin,
          cgstTotal: sum((line) => line.cgst),
          sgstTotal: sum((line) => line.sgst),
          igstTotal: sum((line) => line.igst),
          taxTotal: sum((line) => line.cgst + line.sgst + line.igst),
          itcEligible,
          createdBy: session.userId,
          createdByName: user.username,
          lines: {
            create: lines.map((line) => ({
              itemId: line.item.id,
              qty: line.qty,
              unitCost: line.unitCost,
              amount: line.amount,
              taxRate: line.taxRate,
              cgstAmount: line.cgst,
              sgstAmount: line.sgst,
              igstAmount: line.igst
            }))
          }
        },
        include: purchaseInclude
      });

      // Averaged over stock before this purchase, so work it out before recording the stock.
      for (const line of lines) {
        const held = await tx.itemStock.aggregate({ where: { itemId: line.item.id, qty: { gt: 0 } }, _sum: { qty: true } });
        const costPrice = weightedAverageCost(toNumber(held._sum.qty), toNumber(line.item.costPrice), line.qty, line.unitCost);
        await tx.item.update({ where: { id: line.item.id }, data: { costPrice } });
      }

      await this.stock.recordStock(
        tx,
        lines.map((line) => ({
          branchId: input.branchId,
          itemId: line.item.id,
          txnType: StockTxnType.PURCHASE,
          qtyIn: line.qty,
          qtyOut: 0,
          costPrice: line.unitCost,
          reason: `${purchaseNo} from ${purchase.supplierName}`,
          referenceType: 'PURCHASE',
          referenceId: purchase.id
        }))
      );
      return purchase;
    });
  }

  /** A branch's purchases, newest first (the latest 200). */
  async listPurchases(session: SessionUser, branchId: string) {
    await this.settings.ensureBranchExists(branchId);
    await this.branches.ensureUserHasBranchAccess(session.userId, branchId);
    return this.prisma.purchase.findMany({
      where: { branchId },
      include: purchaseInclude,
      orderBy: { createdAt: 'desc' },
      take: 200
    });
  }
}
