import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { round3, toNumber } from '../common/numbers';
import { businessToday, lotsOf, sharesOfLines } from '../stock/batch-stock';
import { pickBatches, putBack, type BatchShare } from '../stock/batches';

/**
 * A fallback counter's copy has no batches, so what it sold and took back offline arrives
 * without them. Once its movements are in, those of items kept by batch are put in batches as
 * the server would have: sales from the earliest expiry (expired stock too: the goods are gone),
 * returns back into the batches their sale took. Each movement keeps its id (a repeated sync
 * stays a no-op): it takes the first batch, and new entries take the rest. The item totals
 * don't change; only BatchStock does.
 */
export async function placeOfflineMovementsInBatches(tx: Prisma.TransactionClient, ledgerIds: string[]) {
  if (ledgerIds.length === 0) return;
  const rows = await tx.stockLedger.findMany({
    where: { id: { in: ledgerIds }, batchId: null, txnType: { in: ['SALE', 'RETURN'] }, item: { tracksBatches: true } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
  });
  if (rows.length === 0) return;
  const today = await businessToday(tx);
  // Sales first, so returns find the batches their sale took.
  for (const row of [...rows.filter((r) => r.txnType === 'SALE'), ...rows.filter((r) => r.txnType === 'RETURN')]) {
    const sale = row.txnType === 'SALE';
    const qty = toNumber(sale ? row.qtyOut : row.qtyIn);
    let shares: BatchShare[];
    if (sale) {
      // This sale is already counted against the stock without a batch: count it back to choose.
      const { lots, unbatched } = await lotsOf(tx, row.branchId, row.itemId);
      const picked = pickBatches({ lots, unbatched: round3(unbatched + qty), qty, today, includeExpired: true });
      shares = picked.short > 0 ? [...picked.taken, { batchId: null, qty: picked.short }] : picked.taken;
    } else {
      const returnLine = row.lineId ? await tx.returnInvoiceLine.findUnique({ where: { id: row.lineId }, select: { saleLineId: true } }) : null;
      if (!returnLine) continue;
      const others = await tx.returnInvoiceLine.findMany({ where: { saleLineId: returnLine.saleLineId, id: { not: row.lineId! } }, select: { id: true } });
      const out = (await sharesOfLines(tx, [returnLine.saleLineId], 'OUT')).get(returnLine.saleLineId) ?? [];
      const back = [...(await sharesOfLines(tx, others.map((line) => line.id), 'IN')).values()].flat();
      shares = putBack(out, back, qty);
    }
    if (shares.length === 0 || (shares.length === 1 && shares[0].batchId === null)) continue;
    const [first, ...rest] = shares;
    await tx.stockLedger.update({ where: { id: row.id }, data: { batchId: first.batchId, ...(sale ? { qtyOut: first.qty } : { qtyIn: first.qty }) } });
    if (rest.length > 0) {
      await tx.stockLedger.createMany({
        data: rest.map((share) => ({
          id: randomUUID(),
          branchId: row.branchId,
          itemId: row.itemId,
          txnType: row.txnType,
          qtyIn: sale ? 0 : share.qty,
          qtyOut: sale ? share.qty : 0,
          costPrice: row.costPrice,
          reason: row.reason,
          referenceType: row.referenceType,
          referenceId: row.referenceId,
          lineId: row.lineId,
          batchId: share.batchId,
          createdAt: row.createdAt
        }))
      });
    }
    for (const share of shares) {
      if (!share.batchId) continue;
      const delta = sale ? -share.qty : share.qty;
      await tx.batchStock.upsert({
        where: { branchId_batchId: { branchId: row.branchId, batchId: share.batchId } },
        create: { branchId: row.branchId, batchId: share.batchId, qty: delta },
        update: { qty: { increment: delta } }
      });
    }
  }
}
