import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StockTxnType } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { toNumber, round2, round3 } from '../common/numbers';
import { assertQtyRespectsLeastCount } from '../common/quantities';
import { SettingsService } from '../settings/settings.service';
import { ItemsService } from '../items/items.service';

@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly items: ItemsService
  ) {}

  /**
   * Holds a lock per (branch, item) until the transaction ends, so the on-hand check and
   * the stock write that follows can't interleave with another register's. Every path that
   * takes stock out calls this first; items are locked in sorted order to avoid deadlocks.
   */
  async lockItemStock(tx: Prisma.TransactionClient, branchId: string, itemIds: string[]) {
    for (const itemId of Array.from(new Set(itemIds)).sort()) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`stock:${branchId}:${itemId}`}, 0))`;
    }
  }

  /** Moves the on-hand row for (branch, item) by `delta`. The caller holds the item lock. */
  private async adjustItemStock(tx: Prisma.TransactionClient, branchId: string, itemId: string, delta: number) {
    if (delta === 0) return;
    await tx.itemStock.upsert({
      where: { branchId_itemId: { branchId, itemId } },
      create: { branchId, itemId, qty: delta },
      update: { qty: { increment: delta } }
    });
  }

  /**
   * Every stock movement goes through here: it locks the items, writes the ledger entries
   * and moves the matching ItemStock rows in the same transaction, so on-hand stock always
   * equals the sum of the ledger. Returns the created ledger entries.
   */
  async recordStock(
    tx: Prisma.TransactionClient,
    entries: Array<Omit<Prisma.StockLedgerUncheckedCreateInput, 'qtyIn' | 'qtyOut'> & { qtyIn: number; qtyOut: number }>
  ) {
    const itemsByBranch = new Map<string, string[]>();
    for (const entry of entries) {
      itemsByBranch.set(entry.branchId, [...(itemsByBranch.get(entry.branchId) ?? []), entry.itemId]);
    }
    for (const [branchId, itemIds] of [...itemsByBranch].sort(([a], [b]) => a.localeCompare(b))) {
      await this.lockItemStock(tx, branchId, itemIds);
    }
    const created = [];
    for (const entry of entries) {
      created.push(await tx.stockLedger.create({ data: entry }));
      await this.adjustItemStock(tx, entry.branchId, entry.itemId, round3(entry.qtyIn - entry.qtyOut));
    }
    return created;
  }

  async getOnHandForItem(branchId: string, itemId: string, tx?: Prisma.TransactionClient) {
    const row = await (tx ?? this.prisma).itemStock.findUnique({
      where: { branchId_itemId: { branchId, itemId } },
      select: { qty: true }
    });
    return toNumber(row?.qty ?? 0);
  }

  async getOnHand(branchId: string, itemId?: string) {
    await this.settings.ensureBranchExists(branchId);
    const normalizedItemId = itemId ? await this.items.resolveItemId(itemId) : undefined;

    const rows = await this.prisma.itemStock.findMany({
      where: { branchId, ...(normalizedItemId ? { itemId: normalizedItemId } : {}) },
      select: { itemId: true, qty: true }
    });
    return rows.map((row) => ({ itemId: row.itemId, onHand: toNumber(row.qty) }));
  }

  async getLedger(branchId: string, itemId?: string) {
    await this.settings.ensureBranchExists(branchId);
    const normalizedItemId = itemId ? await this.items.resolveItemId(itemId) : undefined;
    return this.prisma.stockLedger.findMany({
      where: { branchId, ...(normalizedItemId ? { itemId: normalizedItemId } : {}) },
      orderBy: { createdAt: 'desc' }
    });
  }

  async createStockOpening(branchId: string, itemId: string, qty: number, costPrice?: number, reason?: string) {
    await this.settings.ensureBranchExists(branchId);
    const normalizedItemId = await this.items.resolveItemId(itemId);
    const item = await this.prisma.item.findUnique({
      where: { id: normalizedItemId },
      select: { leastCount: true }
    });
    if (!item) throw new NotFoundException('Item not found');
    assertQtyRespectsLeastCount(qty, toNumber(item.leastCount), 'Opening stock');

    return this.prisma.$transaction(async (tx) => {
      await this.lockItemStock(tx, branchId, [normalizedItemId]);
      const existingOpening = await tx.stockLedger.findFirst({
        where: {
          branchId,
          itemId: normalizedItemId,
          txnType: StockTxnType.OPENING
        }
      });

      if (existingOpening) {
        throw new BadRequestException('Opening stock already exists for this item');
      }

      const [entry] = await this.recordStock(tx, [
        { branchId, itemId: normalizedItemId, txnType: StockTxnType.OPENING, qtyIn: qty, qtyOut: 0, costPrice: costPrice ?? 0, reason }
      ]);
      return entry;
    });
  }

  async updateStockOpening(branchId: string, itemId: string, qty: number, costPrice?: number, reason?: string) {
    await this.settings.ensureBranchExists(branchId);
    const normalizedItemId = await this.items.resolveItemId(itemId);
    const item = await this.prisma.item.findUnique({
      where: { id: normalizedItemId },
      select: { leastCount: true }
    });
    if (!item) throw new NotFoundException('Item not found');
    assertQtyRespectsLeastCount(qty, toNumber(item.leastCount), 'Opening stock');

    return this.prisma.$transaction(async (tx) => {
      await this.lockItemStock(tx, branchId, [normalizedItemId]);
      const opening = await tx.stockLedger.findFirst({
        where: {
          branchId,
          itemId: normalizedItemId,
          txnType: StockTxnType.OPENING
        }
      });

      if (!opening) {
        throw new NotFoundException('Opening stock does not exist for this item');
      }

      const currentOnHand = await this.getOnHandForItem(branchId, normalizedItemId, tx);
      const openingQty = toNumber(opening.qtyIn);
      const newOnHand = round2(currentOnHand - openingQty + qty);

      if (newOnHand < 0) {
        throw new BadRequestException('Opening qty cannot be less than already consumed stock');
      }

      const updated = await tx.stockLedger.update({
        where: { id: opening.id },
        data: {
          qtyIn: qty,
          qtyOut: 0,
          costPrice: costPrice ?? toNumber(opening.costPrice),
          reason
        }
      });
      await this.adjustItemStock(tx, branchId, normalizedItemId, round3(qty - openingQty));
      return updated;
    });
  }

  async createStockAdjustment(branchId: string, itemId: string, qty: number, direction: 'IN' | 'OUT', costPrice: number | undefined, reason: string) {
    await this.settings.ensureBranchExists(branchId);
    const normalizedItemId = await this.items.resolveItemId(itemId);
    const item = await this.prisma.item.findUnique({
      where: { id: normalizedItemId },
      select: { leastCount: true }
    });
    if (!item) throw new NotFoundException('Item not found');
    assertQtyRespectsLeastCount(qty, toNumber(item.leastCount), 'Stock adjustment');

    return this.prisma.$transaction(async (tx) => {
      if (direction === 'OUT') {
        await this.lockItemStock(tx, branchId, [normalizedItemId]);
        const onHand = await this.getOnHandForItem(branchId, normalizedItemId, tx);
        if (onHand < qty) throw new BadRequestException('Insufficient stock for adjustment out');
      }

      const [entry] = await this.recordStock(tx, [
        {
          branchId,
          itemId: normalizedItemId,
          txnType: direction === 'IN' ? StockTxnType.ADJUSTMENT_PLUS : StockTxnType.ADJUSTMENT_MINUS,
          qtyIn: direction === 'IN' ? qty : 0,
          qtyOut: direction === 'OUT' ? qty : 0,
          costPrice: costPrice ?? 0,
          reason
        }
      ]);
      return entry;
    });
  }
}
