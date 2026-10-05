import type { StockItem } from "./types";
import { formatStockOnHand } from "../pos/cartMath";
import { useBatches } from "./useBatches";

/** The selected item's batches at the branch, earliest expiry first (items kept by batch). */
export function BatchesCard({ branchId, item, onHand }: { branchId: string; item: StockItem; onHand: number }) {
  const batches = useBatches(branchId, { itemId: item.id }, item.tracksBatches);
  if (!item.tracksBatches) return null;
  const inBatches = (batches.data ?? []).reduce((sum, batch) => sum + batch.qty, 0);
  const withoutBatch = Math.round((onHand - inBatches) * 1000) / 1000;
  return (
    <div className="card p-5">
      <h3 className="mb-3 text-sm font-semibold text-slate-900">Batches</h3>
      {batches.isLoading ? (
        <p className="text-sm text-slate-500">Loading batches...</p>
      ) : (batches.data ?? []).length === 0 && withoutBatch === 0 ? (
        <p className="text-sm text-slate-500">No stock in any batch.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="eyebrow border-b border-slate-200 text-left">
              <th className="py-2">Batch</th>
              <th className="py-2">Expires</th>
              <th className="py-2 text-right">On hand</th>
            </tr>
          </thead>
          <tbody>
            {(batches.data ?? []).map((batch) => (
              <tr key={batch.batchId} className="border-b border-slate-100">
                <td className="py-2 pr-3 font-medium text-slate-900">{batch.batchNo}</td>
                <td className={`py-2 pr-3 ${batch.expired ? "font-semibold text-rose-700" : ""}`}>
                  {batch.expiryDate ?? "-"}
                  {batch.expired ? " (expired: can't be sold)" : ""}
                </td>
                <td className="py-2 text-right tabular-nums">{formatStockOnHand(batch.qty)}</td>
              </tr>
            ))}
            {withoutBatch !== 0 ? (
              <tr className="border-b border-slate-100 text-slate-500">
                <td className="py-2 pr-3" colSpan={2}>
                  Without a batch (from before batches were tracked, or sold past the count)
                </td>
                <td className="py-2 text-right tabular-nums">{formatStockOnHand(withoutBatch)}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      )}
    </div>
  );
}
