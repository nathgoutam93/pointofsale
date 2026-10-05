import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { api, apiErrorMessage, authHeaders } from "../../lib/api";
import { formatStockOnHand } from "../pos/cartMath";

/** An item's stock row at the branch: on hand, and its reorder level there. */
export type StockLevel = { onHand: number; reorderLevel: number | null; reorderQty: number | null };

export const isLow = (level: StockLevel | undefined) =>
  !!level && level.reorderLevel !== null && level.onHand <= level.reorderLevel;

const refreshStock = (queryClient: ReturnType<typeof useQueryClient>, branchId: string) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: ["stock-module", branchId] }),
    queryClient.invalidateQueries({ queryKey: ["low-stock", branchId] }),
  ]);

/** The selected item's reorder level at the branch, and (for stock changers) a form to set it. */
export function ReorderLevel({ branchId, itemId, level, canChange }: { branchId: string; itemId: string; level: StockLevel | undefined; canChange: boolean }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [reorderLevel, setReorderLevel] = useState("");
  const [reorderQty, setReorderQty] = useState("");
  const save = useMutation({
    mutationFn: async (clear: boolean) => {
      const res = await api.stock.setReorderLevel({
        body: {
          branchId,
          itemId,
          reorderLevel: clear || reorderLevel.trim() === "" ? null : Number(reorderLevel),
          reorderQty: clear || reorderQty.trim() === "" ? null : Number(reorderQty),
        },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "The reorder level couldn't be saved."));
    },
    onSuccess: async () => {
      setEditing(false);
      await refreshStock(queryClient, branchId);
    },
  });
  const current = level?.reorderLevel ?? null;

  return (
    <div>
      <dt className="eyebrow">Reorder level</dt>
      {editing ? (
        <form
          className="mt-1 grid gap-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            save.mutate(false);
          }}
        >
          <div className="flex gap-2">
            <input className="field w-24 py-1" type="number" min="0" step="any" placeholder="Level" aria-label="Reorder level" value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} required autoFocus />
            <input className="field w-24 py-1" type="number" min="0" step="any" placeholder="Order qty" aria-label="Order quantity" value={reorderQty} onChange={(e) => setReorderQty(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <button className="btn-primary px-3 py-1" type="submit" disabled={save.isPending}>Save</button>
            {current !== null ? (
              <button className="btn-ghost px-2 py-1" type="button" disabled={save.isPending} onClick={() => save.mutate(true)}>Stop watching</button>
            ) : null}
            <button className="btn-ghost px-2 py-1" type="button" onClick={() => setEditing(false)}>Cancel</button>
          </div>
          {save.error ? <p className="text-xs text-rose-700">{(save.error as Error).message}</p> : null}
        </form>
      ) : (
        <dd className="mt-1 text-sm text-slate-900">
          {current === null ? (
            <span className="text-slate-500">Not set</span>
          ) : (
            <>
              <span className={`font-semibold tabular-nums ${isLow(level) ? "text-amber-700" : ""}`}>{formatStockOnHand(current)}</span>
              {level?.reorderQty !== null && level?.reorderQty !== undefined ? <span className="text-slate-500"> · order {formatStockOnHand(level.reorderQty)}</span> : null}
              {isLow(level) ? <span className="badge ml-2 bg-amber-50 text-amber-700 ring-1 ring-amber-200 ring-inset">Low</span> : null}
            </>
          )}
          {canChange ? (
            <button
              type="button"
              className="ml-2 text-xs font-medium text-brand-700 hover:underline"
              onClick={() => {
                setReorderLevel(current === null ? "" : String(current));
                setReorderQty(level?.reorderQty === null || level?.reorderQty === undefined ? "" : String(level.reorderQty));
                setEditing(true);
              }}
            >
              {current === null ? "Set" : "Change"}
            </button>
          ) : null}
        </dd>
      )}
    </div>
  );
}

/** What is running low at the branch, with how much to order: the shopping list. */
export function LowStockCard({ branchId, onSelect }: { branchId: string; onSelect: (itemId: string) => void }) {
  const low = useQuery({
    queryKey: ["low-stock", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const res = await api.stock.lowStock({ query: { branchId }, extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error("Couldn't load low stock");
      return res.body;
    },
  });
  const rows = low.data ?? [];
  return (
    <div className="card p-5">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-900">Low stock</h3>
        <p className="text-xs text-slate-500">Items at or below their reorder level at this branch. Set an item's level above, under its stock.</p>
      </div>
      {low.isLoading ? (
        <p className="text-sm text-slate-500">Loading...</p>
      ) : low.error ? (
        <p className="text-sm text-rose-700">{(low.error as Error).message}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing is running low.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="eyebrow border-b border-slate-200 text-left">
              <th className="py-2">Item</th>
              <th className="py-2 text-right">On hand</th>
              <th className="py-2 text-right">Level</th>
              <th className="py-2 text-right">Order</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.itemId} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => onSelect(row.itemId)}>
                <td className="py-2 pr-3">
                  {row.itemName} <span className="text-xs text-slate-500">{row.itemCode}</span>
                </td>
                <td className={`py-2 text-right tabular-nums ${row.onHand <= 0 ? "font-semibold text-rose-700" : "text-amber-700"}`}>
                  {formatStockOnHand(row.onHand)} {row.uom}
                </td>
                <td className="py-2 text-right tabular-nums">{formatStockOnHand(row.reorderLevel)}</td>
                <td className="py-2 text-right tabular-nums">{row.reorderQty === null ? "—" : formatStockOnHand(row.reorderQty)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
