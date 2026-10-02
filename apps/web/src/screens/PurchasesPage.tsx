import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useMemo, useState } from "react";
import { IconTrash } from "../components/icons";
import { api, apiErrorMessage, authHeaders } from "../lib/api";
import { inr, requireOperationalSession } from "./route-helpers";
import { ItemPicker } from "./stock/ItemPicker";

type DraftLine = { itemId: string; code: string; name: string; uom: string; qty: string; unitCost: string };

const emptySupplier = { supplierName: "", supplierGstin: "", supplierInvoiceNo: "", supplierInvoiceDate: "", note: "" };

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-IN", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/**
 * Goods received from suppliers at this branch. Saving adds the stock and moves each item's
 * cost to the weighted average of the stock held and the new purchase.
 */
export function PurchasesPage() {
  const session = requireOperationalSession();
  const queryClient = useQueryClient();
  const [supplier, setSupplier] = useState(emptySupplier);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const items = useQuery({
    queryKey: ["items-stock-list"],
    queryFn: async () => {
      const res = await api.items.list({ query: { activeOnly: true }, extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error("Failed to fetch items");
      return res.body;
    },
  });

  const purchases = useQuery({
    queryKey: ["purchases", session.branchId],
    queryFn: async () => {
      const res = await api.purchases.list({ query: { branchId: session.branchId }, extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error("Failed to load purchases");
      return res.body;
    },
  });

  const lineIds = useMemo(() => new Set(lines.map((line) => line.itemId)), [lines]);
  const total = lines.reduce((sum, line) => sum + (Number(line.qty) || 0) * (Number(line.unitCost) || 0), 0);

  const create = useMutation({
    mutationFn: async () => {
      const res = await api.purchases.create({
        body: {
          branchId: session.branchId,
          supplierName: supplier.supplierName.trim(),
          supplierGstin: supplier.supplierGstin.trim() || undefined,
          supplierInvoiceNo: supplier.supplierInvoiceNo.trim() || undefined,
          supplierInvoiceDate: supplier.supplierInvoiceDate || undefined,
          note: supplier.note.trim() || undefined,
          lines: lines.map((line) => ({ itemId: line.itemId, qty: Number(line.qty), unitCost: Number(line.unitCost) })),
        },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 201) throw new Error(apiErrorMessage(res.body, "Failed to save purchase"));
      return res.body;
    },
    onSuccess: (purchase) => {
      setSupplier(emptySupplier);
      setLines([]);
      setError("");
      setSaved(`${purchase.purchaseNo} saved. Stock and item costs are updated.`);
      void queryClient.invalidateQueries({ queryKey: ["purchases", session.branchId] });
      void queryClient.invalidateQueries({ queryKey: ["stock-module", session.branchId] });
      void queryClient.invalidateQueries({ queryKey: ["stock-ledger", session.branchId] });
      void queryClient.invalidateQueries({ queryKey: ["items-stock-list"] });
    },
    onError: (e) => {
      setSaved("");
      setError((e as Error).message);
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!supplier.supplierName.trim()) return setError("Enter the supplier's name");
    if (lines.length === 0) return setError("Add at least one item");
    const bad = lines.find((line) => !(Number(line.qty) > 0) || !(Number(line.unitCost) >= 0) || line.unitCost.trim() === "");
    if (bad) return setError(`Enter a quantity and cost for ${bad.name}`);
    create.mutate();
  };

  const updateLine = (itemId: string, patch: Partial<DraftLine>) =>
    setLines((current) => current.map((line) => (line.itemId === itemId ? { ...line, ...patch } : line)));

  return (
    <section className="space-y-6 p-6">
      <form onSubmit={onSubmit} className="card overflow-visible">
        <div className="border-b border-slate-200 p-5">
          <h2 className="page-title">New Purchase</h2>
          <p className="mt-1 text-sm text-slate-500">
            Goods received from a supplier. Quantities are in each item's base unit and costs are per base unit, before tax.
          </p>
        </div>
        <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-4">
          <label className="block text-sm text-slate-600">
            Supplier name
            <input
              className="field mt-1"
              value={supplier.supplierName}
              onChange={(e) => setSupplier((s) => ({ ...s, supplierName: e.target.value }))}
              required
            />
          </label>
          <label className="block text-sm text-slate-600">
            Supplier GSTIN <span className="text-slate-400">(optional)</span>
            <input
              className="field mt-1 uppercase"
              value={supplier.supplierGstin}
              maxLength={15}
              onChange={(e) => setSupplier((s) => ({ ...s, supplierGstin: e.target.value }))}
            />
          </label>
          <label className="block text-sm text-slate-600">
            Supplier invoice no. <span className="text-slate-400">(optional)</span>
            <input
              className="field mt-1"
              value={supplier.supplierInvoiceNo}
              maxLength={32}
              onChange={(e) => setSupplier((s) => ({ ...s, supplierInvoiceNo: e.target.value }))}
            />
          </label>
          <label className="block text-sm text-slate-600">
            Invoice date <span className="text-slate-400">(optional)</span>
            <input
              className="field mt-1"
              type="date"
              value={supplier.supplierInvoiceDate}
              onChange={(e) => setSupplier((s) => ({ ...s, supplierInvoiceDate: e.target.value }))}
            />
          </label>
        </div>

        <div className="space-y-3 border-t border-slate-100 p-5">
          <ItemPicker
            items={items.data ?? []}
            excludeIds={lineIds}
            onPick={(item) =>
              setLines((current) => [
                ...current,
                { itemId: item.id, code: item.code, name: item.name, uom: item.uom, qty: "", unitCost: String(Number(item.costPrice) || 0) },
              ])
            }
          />
          {lines.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="eyebrow border-b border-slate-200 text-left">
                    <th className="py-2">Item</th>
                    <th className="py-2">Qty</th>
                    <th className="py-2">Unit cost</th>
                    <th className="py-2 text-right">Amount</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.itemId} className="border-b border-slate-100">
                      <td className="py-2 pr-3">
                        <p className="font-medium text-slate-900">{line.name}</p>
                        <p className="text-xs text-slate-500">{line.code}</p>
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-2">
                          <input
                            className="field w-24 py-1"
                            type="number"
                            min="0"
                            step="any"
                            value={line.qty}
                            autoFocus={line.qty === ""}
                            onChange={(e) => updateLine(line.itemId, { qty: e.target.value })}
                          />
                          <span className="text-xs text-slate-500">{line.uom}</span>
                        </div>
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          className="field w-28 py-1"
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.unitCost}
                          onChange={(e) => updateLine(line.itemId, { unitCost: e.target.value })}
                        />
                      </td>
                      <td className="py-2 text-right tabular-nums">{inr((Number(line.qty) || 0) * (Number(line.unitCost) || 0))}</td>
                      <td className="py-2 pl-2 text-right">
                        <button
                          type="button"
                          className="btn-ghost px-2 py-1"
                          aria-label={`Remove ${line.name}`}
                          onClick={() => setLines((current) => current.filter((entry) => entry.itemId !== line.itemId))}
                        >
                          <IconTrash width={16} height={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} className="py-2 text-right font-semibold text-slate-900">
                      Total
                    </td>
                    <td className="py-2 text-right font-semibold tabular-nums text-slate-900">{inr(total)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <label className="block text-sm text-slate-600">
            Note <span className="text-slate-400">(optional)</span>
            <input
              className="field mt-1"
              value={supplier.note}
              maxLength={500}
              onChange={(e) => setSupplier((s) => ({ ...s, note: e.target.value }))}
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn-primary" type="submit" disabled={create.isPending}>
              {create.isPending ? "Saving..." : "Save Purchase"}
            </button>
            {saved ? <span className="text-sm text-emerald-700">{saved}</span> : null}
            {error ? (
              <span className="text-sm text-rose-700" role="alert">
                {error}
              </span>
            ) : null}
          </div>
        </div>
      </form>

      <div className="card overflow-hidden">
        <div className="border-b border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-900">Recent Purchases</h3>
        </div>
        {purchases.isLoading ? (
          <p className="p-5 text-sm text-slate-500">Loading purchases...</p>
        ) : (purchases.data ?? []).length === 0 ? (
          <p className="p-5 text-sm text-slate-500">No purchases at this branch yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {(purchases.data ?? []).map((purchase) => (
              <li key={purchase.id}>
                <button
                  type="button"
                  className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-3 text-left hover:bg-slate-50"
                  onClick={() => setOpenId(openId === purchase.id ? null : purchase.id)}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">
                      {purchase.purchaseNo} · {purchase.supplierName}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatDate(purchase.createdAt)} by {purchase.createdByName}
                      {purchase.supplierInvoiceNo ? ` · Invoice ${purchase.supplierInvoiceNo}` : ""}
                      {purchase.supplierInvoiceDate ? ` (${purchase.supplierInvoiceDate})` : ""}
                      {` · ${purchase.lines.length} item${purchase.lines.length === 1 ? "" : "s"}`}
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-slate-900">{inr(purchase.totalCost)}</span>
                </button>
                {openId === purchase.id && (
                  <div className="bg-slate-50 px-5 pb-4">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="eyebrow border-b border-slate-200 text-left">
                          <th className="py-2">Item</th>
                          <th className="py-2">Qty</th>
                          <th className="py-2">Unit cost</th>
                          <th className="py-2 text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {purchase.lines.map((line) => (
                          <tr key={line.id} className="border-b border-slate-100">
                            <td className="py-2 pr-3">
                              {line.item.name} <span className="text-xs text-slate-500">{line.item.code}</span>
                            </td>
                            <td className="py-2 pr-3 tabular-nums">
                              {Number(line.qty)} {line.item.uom}
                            </td>
                            <td className="py-2 pr-3 tabular-nums">{inr(line.unitCost)}</td>
                            <td className="py-2 text-right tabular-nums">{inr(line.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {purchase.supplierGstin || purchase.note ? (
                      <p className="mt-2 text-xs text-slate-500">
                        {purchase.supplierGstin ? `GSTIN ${purchase.supplierGstin}` : ""}
                        {purchase.supplierGstin && purchase.note ? " · " : ""}
                        {purchase.note ?? ""}
                      </p>
                    ) : null}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
