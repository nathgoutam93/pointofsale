import { round3 } from '../common/numbers';

/** A batch's stock at a branch, as it is taken from. */
export type BatchLot = { batchId: string; batchNo: string; expiryDate: string | null; createdAt: Date; qty: number };
/** Where stock comes from or goes to: a batch, or (null) the item's stock without one. */
export type BatchShare = { batchId: string | null; qty: number };

/** Whether a batch is past its expiry date (the last day it may be sold) on `today` (YYYY-MM-DD). */
export const isExpired = (expiryDate: string | null, today: string) => !!expiryDate && expiryDate < today;

/**
 * Where `qty` of an item comes from, earliest expiry first: first the stock without a batch
 * (from before the item tracked batches, so the oldest), then the batches that haven't expired
 * by expiry date (those without one last, then the oldest batch). Expired batches are taken only
 * when `includeExpired` (a stock adjustment writing them off), after the rest. `short` is what
 * couldn't be found; `expired` is how much expired stock was passed over.
 */
export function pickBatches(input: { lots: BatchLot[]; unbatched: number; qty: number; today: string; includeExpired?: boolean }) {
  const fresh = input.lots.filter((lot) => lot.qty > 0 && !isExpired(lot.expiryDate, input.today));
  const expired = input.lots.filter((lot) => lot.qty > 0 && isExpired(lot.expiryDate, input.today));
  const byExpiry = (a: BatchLot, b: BatchLot) =>
    (a.expiryDate ?? '9999-12-31').localeCompare(b.expiryDate ?? '9999-12-31') || a.createdAt.getTime() - b.createdAt.getTime() || a.batchId.localeCompare(b.batchId);
  const sources: BatchShare[] = [
    ...(input.unbatched > 0 ? [{ batchId: null, qty: input.unbatched }] : []),
    ...fresh.sort(byExpiry).map((lot) => ({ batchId: lot.batchId, qty: lot.qty })),
    ...(input.includeExpired ? expired.sort(byExpiry).map((lot) => ({ batchId: lot.batchId, qty: lot.qty })) : [])
  ];
  const taken: BatchShare[] = [];
  let left = round3(input.qty);
  for (const source of sources) {
    if (left <= 0) break;
    const qty = round3(Math.min(left, source.qty));
    taken.push({ batchId: source.batchId, qty });
    left = round3(left - qty);
  }
  return {
    taken,
    short: Math.max(0, left),
    expired: input.includeExpired ? 0 : round3(expired.reduce((sum, lot) => sum + lot.qty, 0))
  };
}

/**
 * Splits document lines' quantities over the shares their item's stock was taken from, in
 * order (two lines of one item, a box and loose pieces, take one after the other).
 */
export function splitOverShares<L extends { itemId: string; qty: number }>(lines: L[], sharesByItem: Map<string, BatchShare[]>) {
  const left = new Map([...sharesByItem].map(([itemId, shares]) => [itemId, shares.map((share) => ({ ...share }))]));
  return lines.flatMap((line) => {
    const shares = left.get(line.itemId);
    if (!shares) return [{ line, batchId: null as string | null, qty: line.qty }];
    const parts: Array<{ line: L; batchId: string | null; qty: number }> = [];
    let want = round3(line.qty);
    for (const share of shares) {
      if (want <= 0) break;
      if (share.qty <= 0) continue;
      const qty = round3(Math.min(want, share.qty));
      parts.push({ line, batchId: share.batchId, qty });
      share.qty = round3(share.qty - qty);
      want = round3(want - qty);
    }
    // Anything not covered (stock sold past the count) has no batch.
    if (want > 0) parts.push({ line, batchId: null, qty: want });
    return parts;
  });
}

/**
 * Where goods coming back go: into the batches they left from (`out`, in that order), up to
 * what each sent out less what already came back to it (`back`), then without a batch.
 */
export function putBack(out: BatchShare[], back: BatchShare[], qty: number): BatchShare[] {
  const returned = new Map<string | null, number>();
  for (const share of back) returned.set(share.batchId, round3((returned.get(share.batchId) ?? 0) + share.qty));
  const shares: BatchShare[] = [];
  let left = round3(qty);
  for (const share of out) {
    if (left <= 0) break;
    const already = returned.get(share.batchId) ?? 0;
    const room = round3(share.qty - already);
    returned.set(share.batchId, round3(Math.max(0, already - share.qty)));
    if (room <= 0) continue;
    const take = round3(Math.min(left, room));
    shares.push({ batchId: share.batchId, qty: take });
    left = round3(left - take);
  }
  if (left > 0) shares.push({ batchId: null, qty: left });
  return shares;
}
