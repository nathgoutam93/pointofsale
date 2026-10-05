import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, apiErrorMessage, authHeaders } from "../../lib/api";
import { getSession } from "../../lib/session";
import { inr } from "../route-helpers";

type Unit = { uom: string; sellPrice: number | string; mrp: number | string };

/**
 * Admin: a branch's own prices for an item, one per unit it is sold in. A branch without
 * its own price for a unit sells at the item's price; clearing goes back to those.
 */
export function BranchPricesSection({
  itemId,
  baseUom,
  units,
}: {
  itemId: string;
  baseUom: string;
  units: Unit[];
}) {
  const queryClient = useQueryClient();
  const branches = useMemo(() => getSession()?.branches ?? [], []);
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [draft, setDraft] = useState<Record<string, { sellPrice: string; mrp: string }>>({});
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const prices = useQuery({
    queryKey: ["item-branch-prices", itemId],
    queryFn: async () => {
      const res = await api.items.branchPrices({ params: { id: itemId }, extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error("Failed to load branch prices");
      return res.body;
    },
  });

  const forBranch = useMemo(
    () => (prices.data ?? []).filter((price) => price.branchId === branchId),
    [prices.data, branchId],
  );
  const branchesWithPrices = useMemo(
    () => branches.filter((branch) => (prices.data ?? []).some((price) => price.branchId === branch.id)),
    [branches, prices.data],
  );

  // Start the form from the branch's saved prices whenever the branch or the data changes.
  useEffect(() => {
    const next: Record<string, { sellPrice: string; mrp: string }> = {};
    for (const unit of units) {
      const own = forBranch.find((price) => price.uom.toLowerCase() === unit.uom.toLowerCase());
      next[unit.uom] = own ? { sellPrice: String(Number(own.sellPrice)), mrp: String(Number(own.mrp)) } : { sellPrice: "", mrp: "" };
    }
    setDraft(next);
    setError("");
    setSaved("");
  }, [forBranch, units]);

  const save = useMutation({
    mutationFn: async (body: { branchId: string; prices: Array<{ uom: string; sellPrice: number; mrp?: number }> }) => {
      const res = await api.items.setBranchPrices({ params: { id: itemId }, body, extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "Failed to save branch prices"));
      return res.body;
    },
    onSuccess: (_data, body) => {
      setError("");
      setSaved(body.prices.length ? "Saved." : "Back to the item's prices.");
      void queryClient.invalidateQueries({ queryKey: ["item-branch-prices", itemId] });
      void queryClient.invalidateQueries({ queryKey: ["items-pos"] });
    },
    onError: (e) => setError((e as Error).message),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const rows = [];
    for (const unit of units) {
      const entry = draft[unit.uom];
      if (!entry || entry.sellPrice.trim() === "") continue;
      const sellPrice = Number(entry.sellPrice);
      const mrp = entry.mrp.trim() === "" ? undefined : Number(entry.mrp);
      if (!Number.isFinite(sellPrice) || sellPrice < 0 || (mrp !== undefined && (!Number.isFinite(mrp) || mrp < 0))) {
        setError(`Enter a valid price for ${unit.uom}`);
        return;
      }
      rows.push({ uom: unit.uom, sellPrice, mrp });
    }
    save.mutate({ branchId, prices: rows });
  };

  if (branches.length === 0) return null;

  return (
    <form onSubmit={onSubmit} className="md:col-span-2 overflow-hidden rounded-md border border-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div>
          <p className="eyebrow">Branch Prices</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {branchesWithPrices.length
              ? `Own prices at ${branchesWithPrices.map((branch) => branch.name).join(", ")}.`
              : "Every branch sells at the item's prices."}
          </p>
        </div>
        <select className="field w-auto py-1 text-sm" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="eyebrow">
            <tr>
              <th className="px-3 py-2">UOM</th>
              <th className="px-3 py-2">Item price</th>
              <th className="px-3 py-2">Branch price</th>
              <th className="px-3 py-2">Branch MRP</th>
            </tr>
          </thead>
          <tbody>
            {units.map((unit) => (
              <tr key={unit.uom} className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium text-slate-900">
                  {unit.uom}
                  {unit.uom === baseUom ? <span className="ml-2 text-xs font-normal text-slate-500">base</span> : null}
                </td>
                <td className="px-3 py-2 text-slate-700 tabular-nums">
                  {inr(unit.sellPrice)} <span className="text-xs text-slate-400">MRP {inr(unit.mrp)}</span>
                </td>
                <td className="px-3 py-1.5">
                  <input
                    className="field w-28 py-1"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Item price"
                    value={draft[unit.uom]?.sellPrice ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, [unit.uom]: { ...d[unit.uom], sellPrice: e.target.value } }))}
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    className="field w-28 py-1"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Item MRP"
                    value={draft[unit.uom]?.mrp ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, [unit.uom]: { ...d[unit.uom], mrp: e.target.value } }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-3 py-2">
        <button className="btn-primary py-1.5" type="submit" disabled={save.isPending || !branchId}>
          {save.isPending ? "Saving..." : "Save Branch Prices"}
        </button>
        <button
          className="btn-ghost py-1.5"
          type="button"
          disabled={save.isPending || forBranch.length === 0}
          onClick={() => save.mutate({ branchId, prices: [] })}
        >
          Use Item Prices
        </button>
        <span className="text-xs text-slate-500">Leave a price blank to use the item's price for that unit.</span>
        {saved ? <span className="text-xs text-emerald-700">{saved}</span> : null}
        {error ? (
          <span className="text-xs text-rose-700" role="alert">
            {error}
          </span>
        ) : null}
      </div>
    </form>
  );
}
