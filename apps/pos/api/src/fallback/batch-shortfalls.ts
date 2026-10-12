import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { round3, toNumber } from '../common/numbers';
import type { FallbackOutbox } from './fallback.service';

type Invoices = FallbackOutbox['invoices'];
type Returns = NonNullable<FallbackOutbox['returns']>;

export type BatchShortfall = {
  branchId: string;
  batchId: string;
  batchNo: string;
  itemId: string;
  qty: number;
  /** Who sold it offline (the bill's cashier), for the activity log. */
  userId: string;
  userName: string;
};

/**
 * A fallback counter sells from the batches its copy showed, but another till may have sold the
 * same goods meanwhile. A sale that would take a batch below what the server has takes what the
 * batch has, and the rest is counted as stock without a batch, as an online sale past stock is:
 * the item's total still drops by everything sold, so it shows below zero on the Stock page to be
 * counted. The sync goes ahead; refusing it would hold back every bill on the counter.
 *
 * Movements the server already has (a repeated sync) are left alone. Answers the bills and
 * returns with those movements split, and what each batch was short.
 */
export async function placeBatchShortfalls(tx: Prisma.TransactionClient, invoices: Invoices, returns: Returns) {
  const all = [...invoices.flatMap((entry) => entry.ledger), ...returns.flatMap((entry) => entry.ledger)];
  const batched = all.filter((row) => row.batchId);
  if (batched.length === 0) return { invoices, returns, shortfalls: [] as BatchShortfall[] };

  const known = new Set(
    (await tx.stockLedger.findMany({ where: { id: { in: batched.map((row) => String(row.id)) } }, select: { id: true } })).map((row) => row.id)
  );
  const fresh = batched
    .filter((row) => !known.has(String(row.id)))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.id).localeCompare(String(b.id)));
  const batches = new Map(
    (await tx.itemBatch.findMany({ where: { id: { in: [...new Set(fresh.map((row) => String(row.batchId)))] } }, include: { stocks: true } })).map(
      (batch) => [batch.id, batch]
    )
  );
  const sellerOf = new Map(
    invoices.flatMap((entry) => entry.ledger.map((row) => [String(row.id), { userId: String(entry.invoice.createdBy), userName: String(entry.invoice.createdByName ?? 'Offline counter') }]))
  );

  const balance = new Map<string, number>();
  const replaced = new Map<string, Array<Record<string, unknown>>>();
  const shortfalls = new Map<string, BatchShortfall>();
  for (const row of fresh) {
    const batch = batches.get(String(row.batchId));
    // A batch of another item is refused by syncConflicts.
    if (!batch || batch.itemId !== String(row.itemId)) continue;
    const branchId = String(row.branchId);
    const key = `${branchId}:${batch.id}`;
    const onHand = balance.get(key) ?? toNumber(batch.stocks.find((stock) => stock.branchId === branchId)?.qty);
    const qtyOut = Number(row.qtyOut ?? 0);
    if (row.txnType !== 'SALE' || qtyOut <= 0) {
      balance.set(key, round3(onHand + Number(row.qtyIn ?? 0) - qtyOut));
      continue;
    }
    const fromBatch = round3(Math.min(qtyOut, Math.max(onHand, 0)));
    const short = round3(qtyOut - fromBatch);
    balance.set(key, round3(onHand - fromBatch));
    if (short <= 0) continue;

    const unbatched = { ...row, batchId: null, qtyOut: short };
    replaced.set(String(row.id), fromBatch > 0 ? [{ ...row, qtyOut: fromBatch }, { ...unbatched, id: randomUUID() }] : [unbatched]);
    const seller = sellerOf.get(String(row.id)) ?? { userId: 'offline', userName: 'Offline counter' };
    const total = shortfalls.get(key);
    shortfalls.set(key, total ? { ...total, qty: round3(total.qty + short) } : { branchId, batchId: batch.id, batchNo: batch.batchNo, itemId: batch.itemId, qty: short, ...seller });
  }
  if (replaced.size === 0) return { invoices, returns, shortfalls: [] as BatchShortfall[] };

  const split = (ledger: Array<Record<string, unknown>>) => ledger.flatMap((row) => replaced.get(String(row.id)) ?? [row]);
  return {
    invoices: invoices.map((entry) => ({ ...entry, ledger: split(entry.ledger) })),
    returns: returns.map((entry) => ({ ...entry, ledger: split(entry.ledger) })),
    shortfalls: [...shortfalls.values()]
  };
}
