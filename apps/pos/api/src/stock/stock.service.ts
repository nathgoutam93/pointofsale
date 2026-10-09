import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StockTxnType } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { toNumber, round3 } from '../common/numbers';
import { assertQtyRespectsLeastCount } from '../common/quantities';
import { afterCursor, newestFirst, type PageQuery } from '../common/paging';
import { SettingsService } from '../settings/settings.service';
import { ItemsService } from '../items/items.service';
import { businessToday, resolveBatch, takeFromBatches } from './batch-stock';
import { isExpired } from './batches';
import { addDays } from '../suppliers/supplier-ledger';

const onHandSelect = { itemId: true, qty: true, reorderLevel: true, reorderQty: true } as const;
const onHandView = (row: { itemId: string; qty: Prisma.Decimal; reorderLevel: Prisma.Decimal | null; reorderQty: Prisma.Decimal | null }) => ({
  itemId: row.itemId,
  onHand: toNumber(row.qty),
  reorderLevel: row.reorderLevel === null ? null : toNumber(row.reorderLevel),
  reorderQty: row.reorderQty === null ? null : toNumber(row.reorderQty)
});

/** The batch stock comes in or goes out of, for items that track batches. */
export type BatchInput = { batchNo?: string; expiryDate?: string };

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
    // And each batch moved, the same way (BatchStock is the sum of its batch's entries).
    const batchDeltas = new Map<string, { branchId: string; batchId: string; delta: number }>();
    for (const entry of entries) {
      if (!entry.batchId) continue;
      const key = `${entry.branchId}:${entry.batchId}`;
      const current = batchDeltas.get(key) ?? { branchId: entry.branchId, batchId: entry.batchId, delta: 0 };
      current.delta = round3(current.delta + entry.qtyIn - entry.qtyOut);
      batchDeltas.set(key, current);
    }
    const batchMoves = [...batchDeltas.values()].filter((move) => move.delta !== 0);
    if (batchMoves.length > 0) {
      await tx.$executeRaw`
        INSERT INTO "BatchStock" ("branchId", "batchId", "qty", "updatedAt")
        SELECT branch, batch, delta, now()
        FROM unnest(${batchMoves.map((move) => move.branchId)}::text[], ${batchMoves.map((move) => move.batchId)}::text[], ${batchMoves.map((move) => move.delta)}::numeric[])
          AS moves(branch, batch, delta)
        ON CONFLICT ("branchId", "batchId") DO UPDATE SET "qty" = "BatchStock"."qty" + EXCLUDED."qty", "updatedAt" = now()`;
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
      select: onHandSelect
    });
    return rows.map(onHandView);
  }

  /** Sets (or with nulls clears) an item's reorder level and order quantity at a branch. */
  async setReorderLevel(branchId: string, itemId: string, reorderLevel: number | null, reorderQty: number | null) {
    await this.settings.ensureBranchExists(branchId);
    const item = await this.prisma.item.findUnique({ where: { id: itemId }, select: { id: true } });
    if (!item) throw new NotFoundException('Item not found');
    if (reorderLevel === null && reorderQty !== null) throw new BadRequestException('Set the reorder level to set an order quantity');
    // A row with no stock yet starts at 0, matching its (empty) movements.
    const row = await this.prisma.itemStock.upsert({
      where: { branchId_itemId: { branchId, itemId } },
      create: { branchId, itemId, qty: 0, reorderLevel, reorderQty },
      update: { reorderLevel, reorderQty },
      select: onHandSelect
    });
    return onHandView(row);
  }

  /** Active items at or below their reorder level at a branch, the furthest below it first. */
  async lowStock(branchId: string) {
    await this.settings.ensureBranchExists(branchId);
    const rows = await this.prisma.itemStock.findMany({
      where: { branchId, reorderLevel: { not: null }, item: { isActive: true } },
      select: { ...onHandSelect, item: { select: { code: true, name: true, category: true, uom: true } } }
    });
    return rows
      .map((row) => ({ ...onHandView(row), reorderLevel: toNumber(row.reorderLevel), item: row.item }))
      .filter((row) => row.onHand <= row.reorderLevel)
      .sort((a, b) => a.onHand - a.reorderLevel - (b.onHand - b.reorderLevel) || a.item.name.localeCompare(b.item.name))
      .map(({ item, ...row }) => ({ ...row, itemCode: item.code, itemName: item.name, category: item.category, uom: item.uom }));
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

  /** The item, with its batch for `batch` when it tracks batches (which then must be given). */
  private async itemAndBatch(tx: Prisma.TransactionClient, itemId: string, batch: BatchInput | undefined, what: string) {
    const item = await tx.item.findUnique({ where: { id: itemId }, select: { id: true, name: true, leastCount: true, tracksBatches: true } });
    if (!item) throw new NotFoundException('Item not found');
    if (!item.tracksBatches) return { item, batchId: null };
    if (!batch?.batchNo?.trim()) throw new BadRequestException(`${item.name} is kept by batch: enter the batch number for the ${what}`);
    return { item, batchId: (await resolveBatch(tx, item, batch.batchNo, batch.expiryDate ?? null)).id };
  }

  /** The opening count of an item at a branch; one per batch for items that track batches. */
  /**
   * Batches with stock at a branch, earliest expiry first: of one item, or those expiring within
   * `expiringWithinDays` days (expired ones included).
   */
  async listBatches(branchId: string, filter: { itemId?: string; expiringWithinDays?: number }) {
    await this.settings.ensureBranchExists(branchId);
    const today = await businessToday(this.prisma);
    const until = filter.expiringWithinDays === undefined ? undefined : addDays(today, filter.expiringWithinDays);
    const rows = await this.prisma.batchStock.findMany({
      where: {
        branchId,
        qty: { not: 0 },
        batch: {
          ...(filter.itemId ? { itemId: filter.itemId } : {}),
          ...(until ? { expiryDate: { not: null, lte: until } } : {})
        }
      },
      include: { batch: { include: { item: { select: { code: true, name: true } } } } }
    });
    return rows
      .map((row) => ({
        batchId: row.batchId,
        itemId: row.batch.itemId,
        itemCode: row.batch.item.code,
        itemName: row.batch.item.name,
        batchNo: row.batch.batchNo,
        expiryDate: row.batch.expiryDate,
        qty: toNumber(row.qty),
        expired: isExpired(row.batch.expiryDate, today)
      }))
      .sort((a, b) => (a.expiryDate ?? '9999-12-31').localeCompare(b.expiryDate ?? '9999-12-31') || a.itemName.localeCompare(b.itemName) || a.batchNo.localeCompare(b.batchNo));
  }

  async createStockOpening(branchId: string, itemId: string, qty: number, costPrice?: number, reason?: string, batch?: BatchInput) {
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
      const { batchId } = await this.itemAndBatch(tx, normalizedItemId, batch, 'opening stock');
      const existingOpening = await tx.stockLedger.findFirst({
        where: {
          branchId,
          itemId: normalizedItemId,
          txnType: StockTxnType.OPENING,
          ...(batchId ? { batchId } : {})
        }
      });

      if (existingOpening) {
        throw new BadRequestException(batchId ? 'Opening stock already exists for this batch' : 'Opening stock already exists for this item');
      }

      const [entry] = await this.recordStock(tx, [
        { branchId, itemId: normalizedItemId, txnType: StockTxnType.OPENING, qtyIn: qty, qtyOut: 0, costPrice: costPrice ?? 0, reason, batchId }
      ]);
      return entry;
    });
  }

  async updateStockOpening(branchId: string, itemId: string, qty: number, costPrice?: number, reason?: string, batch?: BatchInput) {
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
      const tracked = await tx.item.findUnique({ where: { id: normalizedItemId }, select: { name: true, tracksBatches: true } });
      const batchNo = batch?.batchNo?.trim().toUpperCase();
      if (tracked?.tracksBatches && !batchNo) throw new BadRequestException(`${tracked.name} is kept by batch: say which batch's opening count to correct`);
      const opening = await tx.stockLedger.findFirst({
        where: {
          branchId,
          itemId: normalizedItemId,
          txnType: StockTxnType.OPENING,
          ...(tracked?.tracksBatches ? { batch: { batchNo } } : {})
        }
      });

      if (!opening) {
        throw new NotFoundException('Opening stock does not exist for this item');
      }

      // The opening count can be corrected only until stock has moved: after that, rewriting it
      // would change history, so the difference goes in as a stock adjustment with its reason.
      // (Other batches' opening counts aren't movements.)
      const moved = await tx.stockLedger.count({ where: { branchId, itemId: normalizedItemId, txnType: { not: StockTxnType.OPENING } } });
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
      if (opening.batchId) {
        await tx.batchStock.update({ where: { branchId_batchId: { branchId, batchId: opening.batchId } }, data: { qty: { increment: round3(qty - openingQty) } } });
      }
      return updated;
    });
  }

  /**
   * A correction of the count. For items kept by batch, stock comes in to a batch, and goes out of
   * the batch given, else the earliest expiry first, expired stock included (writing it off).
   */
  async createStockAdjustment(branchId: string, itemId: string, qty: number, direction: 'IN' | 'OUT', costPrice: number | undefined, reason: string, batch?: BatchInput) {
    await this.settings.ensureBranchExists(branchId);
    const normalizedItemId = await this.items.resolveItemId(itemId);
    const item = await this.prisma.item.findUnique({
      where: { id: normalizedItemId },
      select: { leastCount: true }
    });
    if (!item) throw new NotFoundException('Item not found');
    assertQtyRespectsLeastCount(qty, toNumber(item.leastCount), 'Stock adjustment');

    return this.prisma.$transaction(async (tx) => {
      await this.lockItemStock(tx, branchId, [normalizedItemId]);
      const tracked = await tx.item.findUniqueOrThrow({ where: { id: normalizedItemId }, select: { id: true, name: true, tracksBatches: true } });
      let shares: Array<{ batchId: string | null; qty: number }> = [{ batchId: null, qty }];
      if (direction === 'OUT') {
        const onHand = await this.getOnHandForItem(branchId, normalizedItemId, tx);
        if (onHand < qty) throw new BadRequestException('Insufficient stock for adjustment out');
        if (tracked.tracksBatches && batch?.batchNo?.trim()) {
          const named = await tx.itemBatch.findUnique({ where: { itemId_batchNo: { itemId: tracked.id, batchNo: batch.batchNo.trim().toUpperCase() } } });
          if (!named) throw new BadRequestException(`${tracked.name} has no batch ${batch.batchNo.trim().toUpperCase()}`);
          const inBatch = toNumber((await tx.batchStock.findUnique({ where: { branchId_batchId: { branchId, batchId: named.id } } }))?.qty);
          if (inBatch + 1e-9 < qty) throw new BadRequestException(`Batch ${named.batchNo} has ${round3(inBatch)} here, not ${qty}`);
          shares = [{ batchId: named.id, qty }];
        } else if (tracked.tracksBatches) {
          const taken = await takeFromBatches(tx, branchId, new Map([[tracked.id, { name: tracked.name, qty }]]), { today: await businessToday(tx), includeExpired: true });
          shares = taken.get(tracked.id) ?? shares;
        }
      } else if (tracked.tracksBatches) {
        shares = [{ batchId: (await this.itemAndBatch(tx, tracked.id, batch, 'stock coming in')).batchId, qty }];
      }

      const [entry] = await this.recordStock(
        tx,
        shares.map((share) => ({
          branchId,
          itemId: normalizedItemId,
          txnType: direction === 'IN' ? StockTxnType.ADJUSTMENT_PLUS : StockTxnType.ADJUSTMENT_MINUS,
          qtyIn: direction === 'IN' ? share.qty : 0,
          qtyOut: direction === 'OUT' ? share.qty : 0,
          costPrice: costPrice ?? 0,
          reason,
          batchId: share.batchId
        }))
      );
      return entry;
    });
  }
}
