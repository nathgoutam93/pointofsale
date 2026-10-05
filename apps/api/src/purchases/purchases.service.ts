import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma, StockTxnType } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { SessionUser } from '../common/types';
import { toNumber, round2, round3 } from '../common/numbers';
import { assertQtyRespectsLeastCount } from '../common/quantities';
import { BranchesService } from '../branches/branches.service';
import { SettingsService } from '../settings/settings.service';
import { SequenceService } from '../sequences/sequences.service';
import { StockService } from '../stock/stock.service';
import { resolveBatch } from '../stock/batch-stock';
import { addDays } from '../suppliers/supplier-ledger';
import { SuppliersService } from '../suppliers/suppliers.service';
import { chargesGst, splitGst } from '@pos/contracts';
import { purchaseReturnInclude, purchaseReturnView } from './purchase-returns.service';

export type CreatePurchaseInput = {
  branchId: string;
  /** The supplier; or a name, for the supplier found or added by it. */
  supplierId?: string;
  supplierName?: string;
  supplierGstin?: string;
  supplierInvoiceNo?: string;
  supplierInvoiceDate?: string;
  note?: string;
  /** `batchNo` (and `expiryDate`, YYYY-MM-DD) for items that track batches. */
  lines: Array<{ itemId: string; qty: number; unitCost: number; taxRate?: number; batchNo?: string; expiryDate?: string }>;
};

export const purchaseInclude = {
  lines: { include: { item: { select: { code: true, name: true, uom: true } }, batch: { select: { batchNo: true, expiryDate: true } } } }
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
    private readonly stock: StockService,
    private readonly suppliers: SuppliersService
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
        select: { id: true, name: true, leastCount: true, costPrice: true, taxRate: true, tracksBatches: true }
      });
      const supplier = await this.suppliers.resolveForPurchase(tx, input);
      // GST: only a registered supplier charges it; from the same state as CGST + SGST, from
      // another as IGST. It counts as input tax credit when bought under a GSTIN by a regular taxpayer.
      const supplierGstin = input.supplierGstin?.trim().toUpperCase() || supplier.gstin;
      const buyer = await this.settings.gstRegistrationFor(input.branchId, tx);
      const buyerState = buyer.stateCode ?? buyer.gstin?.slice(0, 2) ?? null;
      const interState = !!supplierGstin && !!buyerState && supplierGstin.slice(0, 2) !== buyerState;
      const { taxpayerType } = await this.settings.taxpayerTypeAt(new Date(), tx);
      const itcEligible = !!supplierGstin && !!buyer.gstin && chargesGst(taxpayerType);
      const itemsById = new Map(items.map((item) => [item.id, item]));

      const lines: Array<{ id: string; item: (typeof items)[number]; batchId: string | null; qty: number; unitCost: number; amount: number; taxRate: number; cgst: number; sgst: number; igst: number }> = [];
      for (const line of input.lines) {
        const item = itemsById.get(line.itemId);
        if (!item) throw new NotFoundException(`Item not found: ${line.itemId}`);
        assertQtyRespectsLeastCount(line.qty, toNumber(item.leastCount), item.name);
        const qty = round3(line.qty);
        const unitCost = round2(line.unitCost);
        const amount = round2(qty * unitCost);
        const taxRate = supplierGstin ? (line.taxRate ?? toNumber(item.taxRate)) : 0;
        const tax = round2((amount * taxRate) / 100);
        // Items kept by batch come in a batch, with its expiry date.
        if (item.tracksBatches && !line.batchNo?.trim()) throw new BadRequestException(`Enter the batch number of ${item.name}`);
        const batch = item.tracksBatches ? await resolveBatch(tx, item, line.batchNo!, line.expiryDate ?? null) : null;
        lines.push({ id: randomUUID(), item, batchId: batch?.id ?? null, qty, unitCost, amount, taxRate, ...splitGst(tax, interState) });
      }
      const seen = new Set<string>();
      for (const line of lines) {
        const key = `${line.item.id}:${line.batchId ?? ''}`;
        if (seen.has(key)) throw new BadRequestException(`${line.item.name} is listed more than once${line.batchId ? ' in the same batch' : ''}`);
        seen.add(key);
      }
      const sum = (pick: (line: (typeof lines)[number]) => number) => round2(lines.reduce((acc, line) => acc + pick(line), 0));

      const user = await tx.user.findUnique({ where: { id: session.userId }, select: { username: true } });
      if (!user) throw new NotFoundException('User not found');
      const seq = await this.sequences.nextSequence(input.branchId, 'purchase', tx);
      const purchaseNo = `${seq.prefix}-${seq.branchCode}-${String(seq.seq).padStart(6, '0')}`;

      // Due the supplier's payment terms after their invoice's date (else today); at once without terms.
      const today = await this.suppliers.today(tx);
      const billDate = input.supplierInvoiceDate || today;
      if (input.supplierInvoiceDate && input.supplierInvoiceDate > today) throw new BadRequestException("The supplier's invoice date is in the future");
      const purchase = await tx.purchase.create({
        data: {
          purchaseNo,
          branchId: input.branchId,
          supplierId: supplier.id,
          supplierName: supplier.name,
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
          grandTotal: sum((line) => line.amount + line.cgst + line.sgst + line.igst),
          dueDate: addDays(billDate, supplier.paymentTermsDays ?? 0),
          itcEligible,
          createdBy: session.userId,
          createdByName: user.username,
          lines: {
            create: lines.map((line) => ({
              id: line.id,
              itemId: line.item.id,
              batchId: line.batchId,
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

      // Averaged over stock before this purchase, so work it out before recording the stock;
      // an item bought in two batches counts once, at the cost of both together.
      const boughtByItem = new Map<string, { item: (typeof lines)[number]['item']; qty: number; amount: number }>();
      for (const line of lines) {
        const entry = boughtByItem.get(line.item.id) ?? { item: line.item, qty: 0, amount: 0 };
        boughtByItem.set(line.item.id, { item: line.item, qty: round3(entry.qty + line.qty), amount: entry.amount + line.qty * line.unitCost });
      }
      for (const { item, qty, amount } of boughtByItem.values()) {
        const held = await tx.itemStock.aggregate({ where: { itemId: item.id, qty: { gt: 0 } }, _sum: { qty: true } });
        const costPrice = weightedAverageCost(toNumber(held._sum.qty), toNumber(item.costPrice), qty, qty > 0 ? amount / qty : 0);
        await tx.item.update({ where: { id: item.id }, data: { costPrice } });
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
          referenceId: purchase.id,
          lineId: line.id,
          batchId: line.batchId
        }))
      );
      return purchase;
    });
  }

  /** A branch's purchases, newest first (the latest 200), from one supplier when given. */
  async listPurchases(session: SessionUser, branchId: string, supplierId?: string) {
    await this.settings.ensureBranchExists(branchId);
    await this.branches.ensureUserHasBranchAccess(session.userId, branchId);
    return this.prisma.purchase.findMany({
      where: { branchId, ...(supplierId ? { supplierId } : {}) },
      include: purchaseInclude,
      orderBy: { createdAt: 'desc' },
      take: 200
    });
  }

  /** A purchase with how much of each line has gone back, and its returns. */
  async getPurchase(id: string) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id },
      include: { ...purchaseInclude, lines: { include: { ...purchaseInclude.lines.include, returnLines: { select: { qty: true } } } }, returns: { include: purchaseReturnInclude, orderBy: { createdAt: 'asc' } } }
    });
    if (!purchase) throw new NotFoundException('Purchase not found');
    return {
      ...purchase,
      lines: purchase.lines.map(({ returnLines, ...line }) => ({ ...line, returnedQty: round3(returnLines.reduce((sum, entry) => sum + toNumber(entry.qty), 0)) })),
      returns: purchase.returns.map(purchaseReturnView)
    };
  }
}
