import { useState } from "react";
import { formatStockOnHand } from "../pos/cartMath";
import { useBatches } from "./useBatches";

/** What expires soon at the branch, and what has expired and can't be sold: write it off or send it back. */
export function ExpiryCard({ branchId }: { branchId: string }) {
  const [days, setDays] = useState("30");
  const within = Math.max(0, Math.min(3650, Math.floor(Number(days) || 0)));
  const batches = useBatches(branchId, { expiringWithinDays: within });
  const rows = batches.data ?? [];
  return (
    <div className="card p-5">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Expiring stock</h3>
          <p className="text-xs text-slate-500">Expired batches can't be sold: write them off with a stock adjustment, or send them back to the supplier.</p>
        </div>
        <label className="text-sm text-slate-600">
          Within{" "}
          <input className="field inline-block w-20 py-1" type="number" min="0" max="3650" value={days} onChange={(e) => setDays(e.target.value)} /> days
        </label>
      </div>
      {batches.isLoading ? (
        <p className="text-sm text-slate-500">Loading...</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing expires within {within} days.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="eyebrow border-b border-slate-200 text-left">
              <th className="py-2">Item</th>
              <th className="py-2">Batch</th>
              <th className="py-2">Expires</th>
              <th className="py-2 text-right">On hand</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((batch) => (
              <tr key={batch.batchId} className="border-b border-slate-100">
                <td className="py-2 pr-3">
                  {batch.itemName} <span className="text-xs text-slate-500">{batch.itemCode}</span>
                </td>
                <td className="py-2 pr-3">{batch.batchNo}</td>
                <td className={`py-2 pr-3 ${batch.expired ? "font-semibold text-rose-700" : "text-amber-700"}`}>
                  {batch.expiryDate}
                  {batch.expired ? " (expired)" : ""}
                </td>
                <td className="py-2 text-right tabular-nums">{formatStockOnHand(batch.qty)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
