import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { round3, toNumber } from '../common/numbers';
import { localDate } from '../reports/zoned-dates';
import { isExpired, pickBatches, type BatchLot, type BatchShare } from './batches';

/** Today in the business's time zone (YYYY-MM-DD): batches past their expiry date before it have expired. */
export async function businessToday(tx: Pick<Prisma.TransactionClient, 'businessSettings'>) {
  const settings = await tx.businessSettings.findUnique({ where: { id: 'default' }, select: { timezone: true } });
  const { year, month, day } = localDate(new Date(), settings?.timezone ?? 'Asia/Kolkata');
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The items among `itemIds` that keep their stock by batch. */
export async function batchTrackedItems(tx: Prisma.TransactionClient, itemIds: string[]) {
  if (itemIds.length === 0) return new Set<string>();
  const rows = await tx.item.findMany({ where: { id: { in: itemIds }, tracksBatches: true }, select: { id: true } });
  return new Set(rows.map((row) => row.id));
}

/** An item's batches at a branch, with stock, and its stock without a batch. */
export async function lotsOf(tx: Prisma.TransactionClient, branchId: string, itemId: string) {
  const [rows, total] = await Promise.all([
    tx.batchStock.findMany({ where: { branchId, batch: { itemId } }, include: { batch: true } }),
    tx.itemStock.findUnique({ where: { branchId_itemId: { branchId, itemId } }, select: { qty: true } })
  ]);
  const lots: BatchLot[] = rows.map((row) => ({ batchId: row.batchId, batchNo: row.batch.batchNo, expiryDate: row.batch.expiryDate, createdAt: row.batch.createdAt, qty: toNumber(row.qty) }));
  const inBatches = round3(lots.reduce((sum, lot) => sum + lot.qty, 0));
  return { lots, unbatched: round3(toNumber(total?.qty) - inBatches) };
}

/**
 * The batches stock leaves from, for the items that track them: earliest expiry first, never
 * expired stock (unless `includeExpired`). What isn't there is refused, or (`allowShort`, selling
 * past the stock count) taken without a batch. The caller holds the item locks.
 */
export async function takeFromBatches(
  tx: Prisma.TransactionClient,
  branchId: string,
  wants: Map<string, { name: string; qty: number }>,
  options: { today: string; allowShort?: boolean; includeExpired?: boolean }
) {
  const tracked = await batchTrackedItems(tx, [...wants.keys()]);
  const sharesByItem = new Map<string, BatchShare[]>();
  for (const itemId of tracked) {
    const { name, qty } = wants.get(itemId)!;
    const { lots, unbatched } = await lotsOf(tx, branchId, itemId);
    const picked = pickBatches({ lots, unbatched, qty, today: options.today, includeExpired: options.includeExpired });
    if (picked.short > 0) {
      if (picked.expired > 0) {
        const soonest = lots.filter((lot) => lot.qty > 0 && isExpired(lot.expiryDate, options.today)).sort((a, b) => (a.expiryDate ?? '').localeCompare(b.expiryDate ?? ''))[0];
        throw new BadRequestException(
          `${name}: only ${round3(qty - picked.short)} can be sold; ${picked.expired} more is expired stock (batch ${soonest.batchNo}, expired ${soonest.expiryDate}). Write expired stock off with a stock adjustment.`
        );
      }
      if (!options.allowShort) throw new BadRequestException(`Insufficient stock for ${name}: ${round3(qty - picked.short)} available, ${qty} needed`);
      picked.taken.push({ batchId: null, qty: picked.short });
    }
    sharesByItem.set(itemId, picked.taken);
  }
  return sharesByItem;
}

/**
 * The batch `batchNo` of an item, added the first time it is received. A batch keeps the expiry
 * date it came with: another date for the same batch number is refused.
 */
export async function resolveBatch(tx: Prisma.TransactionClient, item: { id: string; name: string }, batchNo: string, expiryDate: string | null) {
  const number = batchNo.trim().toUpperCase();
  const existing = await tx.itemBatch.findUnique({ where: { itemId_batchNo: { itemId: item.id, batchNo: number } } });
  if (existing) {
    if (expiryDate && existing.expiryDate !== expiryDate) {
      throw new BadRequestException(`${item.name} batch ${number} expires on ${existing.expiryDate ?? 'no date'}, not ${expiryDate}`);
    }
    return existing;
  }
  return tx.itemBatch.create({ data: { itemId: item.id, batchNo: number, expiryDate } });
}

/**
 * The order stock is taken in (see pickBatches): without a batch first, then by expiry date
 * (none last), then the older batch.
 */
export function takenOrder(a: { batch: { expiryDate: string | null; createdAt: Date } | null }, b: { batch: { expiryDate: string | null; createdAt: Date } | null }) {
  if (!a.batch || !b.batch) return (a.batch ? 1 : 0) - (b.batch ? 1 : 0);
  return (a.batch.expiryDate ?? '9999-12-31').localeCompare(b.batch.expiryDate ?? '9999-12-31') || a.batch.createdAt.getTime() - b.batch.createdAt.getTime();
}

/** The batches each document line moved (from its ledger entries), in the order they were taken. */
export async function sharesOfLines(tx: Prisma.TransactionClient, lineIds: string[], direction: 'IN' | 'OUT') {
  const rows = lineIds.length
    ? await tx.stockLedger.findMany({
        where: { lineId: { in: lineIds } },
        select: { lineId: true, batchId: true, qtyIn: true, qtyOut: true, batch: { select: { expiryDate: true, createdAt: true } } }
      })
    : [];
  rows.sort(takenOrder);
  const byLine = new Map<string, BatchShare[]>();
  for (const row of rows) {
    const qty = toNumber(direction === 'IN' ? row.qtyIn : row.qtyOut);
    if (qty <= 0 || !row.lineId) continue;
    byLine.set(row.lineId, [...(byLine.get(row.lineId) ?? []), { batchId: row.batchId, qty }]);
  }
  return byLine;
}
