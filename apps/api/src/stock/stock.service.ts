import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StockTxnType } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { toNumber, round3 } from '../common/numbers';
import { assertQtyRespectsLeastCount } from '../common/quantities';
import { afterCursor, newestFirst, type PageQuery } from '../common/paging';
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
    const keys = Array.from(new Set(itemIds)).sort().map((itemId) => `stock:${branchId}:${itemId}`);
    if (keys.length === 0) return;
    // One statement, taking the locks one after another in key order.
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(key, 0))
      FROM unnest(${keys}::text[]) WITH ORDINALITY AS keys(key, position)
      ORDER BY position`;
  }

  /** On-hand stock of several items at a branch (0 for an item with none recorded). */
  async getOnHandForItems(tx: Prisma.TransactionClient, branchId: string, itemIds: string[]) {
    const rows = await tx.itemStock.findMany({ where: { branchId, itemId: { in: itemIds } }, select: { itemId: true, qty: true } });
    const byItem = new Map(rows.map((row) => [row.itemId, toNumber(row.qty)]));
    return new Map(itemIds.map((itemId) => [itemId, byItem.get(itemId) ?? 0]));
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
    if (entries.length === 0) return [];
    const created = await tx.stockLedger.createManyAndReturn({ data: entries });
    // Each (branch, item) moves once, by the sum of its entries, in one statement.
    const deltas = new Map<string, { branchId: string; itemId: string; delta: number }>();
    for (const entry of entries) {
      const key = `${entry.branchId}:${entry.itemId}`;
      const current = deltas.get(key) ?? { branchId: entry.branchId, itemId: entry.itemId, delta: 0 };
      current.delta = round3(current.delta + entry.qtyIn - entry.qtyOut);
      deltas.set(key, current);
    }
    const moves = [...deltas.values()].filter((move) => move.delta !== 0);
    if (moves.length > 0) {
      await tx.$executeRaw`
        INSERT INTO "ItemStock" ("branchId", "itemId", "qty", "updatedAt")
        SELECT branch, item, delta, now()
        FROM unnest(${moves.map((move) => move.branchId)}::text[], ${moves.map((move) => move.itemId)}::text[], ${moves.map((move) => move.delta)}::numeric[])
          AS moves(branch, item, delta)
        ON CONFLICT ("branchId", "itemId") DO UPDATE SET "qty" = "ItemStock"."qty" + EXCLUDED."qty", "updatedAt" = now()`;
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

  /** A page of the movements, newest first. */
  async getLedger(branchId: string, itemId?: string, page: PageQuery = { limit: 100 }) {
    await this.settings.ensureBranchExists(branchId);
    const normalizedItemId = itemId ? await this.items.resolveItemId(itemId) : undefined;
    return this.prisma.stockLedger.findMany({
      where: { branchId, ...(normalizedItemId ? { itemId: normalizedItemId } : {}), ...afterCursor(page) },
      orderBy: newestFirst,
      take: page.limit
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

      // The opening count can be corrected only until stock has moved: after that, rewriting it
      // would change history, so the difference goes in as a stock adjustment with its reason.
      const moved = await tx.stockLedger.count({ where: { branchId, itemId: normalizedItemId, id: { not: opening.id } } });
      if (moved > 0) {
        throw new BadRequestException('Stock of this item has moved since the opening count. Correct it with a stock adjustment instead.');
      }
      const openingQty = toNumber(opening.qtyIn);

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
