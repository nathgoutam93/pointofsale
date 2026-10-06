import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useMemo, useState } from "react";
import { IconTrash } from "../components/icons";
import { api, apiErrorMessage, authHeaders } from "../lib/api";
import { BranchPicker } from "../components/BranchPicker";
import { useManagedBranch } from "../lib/branch";
import { inr, requireManagementSession } from "./route-helpers";
import { ItemPicker } from "./stock/ItemPicker";
import { PurchaseDetail } from "./purchases/PurchaseDetail";
import { emptySupplierChoice, NEW_SUPPLIER, SupplierPicker, useChosenGstin, type SupplierChoice } from "./purchases/SupplierPicker";

/** `batchNo` and `expiryDate` for items kept by batch. */
type DraftLine = { itemId: string; code: string; name: string; uom: string; qty: string; unitCost: string; taxRate: string; tracksBatches: boolean; batchNo: string; expiryDate: string };

const emptySupplier = { supplierInvoiceNo: "", supplierInvoiceDate: "", note: "" };

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-IN", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/**
 * Goods received from suppliers at this branch. Saving adds the stock, sets each item's cost to
 * the price paid, and adds the total with GST to what the supplier is owed. Goods can be sent back from a purchase's details.
 */
export function PurchasesPage() {
  requireManagementSession();
  const [managedBranch, setManagedBranch] = useManagedBranch();
  const branchId = managedBranch ?? "";
  const queryClient = useQueryClient();
  const [supplier, setSupplier] = useState(emptySupplier);
  const [supplierChoice, setSupplierChoice] = useState<SupplierChoice>(emptySupplierChoice);
  const chosenGstin = useChosenGstin(supplierChoice);
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
    queryKey: ["purchases", branchId],
    queryFn: async () => {
      const res = await api.purchases.list({ query: { branchId: branchId }, extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error("Failed to load purchases");
      return res.body;
    },
  });

  const lineIds = useMemo(() => new Set(lines.map((line) => line.itemId)), [lines]);
  const total = lines.reduce((sum, line) => sum + (Number(line.qty) || 0) * (Number(line.unitCost) || 0), 0);
  // GST is charged only by a registered supplier (with a GSTIN).
  const supplierCharges = chosenGstin.length > 0;
  const taxTotal = supplierCharges
    ? lines.reduce((sum, line) => sum + Math.round((Number(line.qty) || 0) * (Number(line.unitCost) || 0) * (Number(line.taxRate) || 0)) / 100, 0)
    : 0;

  const create = useMutation({
    mutationFn: async () => {
      const res = await api.purchases.create({
        body: {
          branchId: branchId,
          ...(supplierChoice.supplierId === NEW_SUPPLIER
            ? { supplierName: supplierChoice.newName.trim(), supplierGstin: supplierChoice.newGstin.trim().toUpperCase() || undefined }
            : { supplierId: supplierChoice.supplierId }),
          supplierInvoiceNo: supplier.supplierInvoiceNo.trim() || undefined,
          supplierInvoiceDate: supplier.supplierInvoiceDate || undefined,
          note: supplier.note.trim() || undefined,
          lines: lines.map((line) => ({
            itemId: line.itemId,
            qty: Number(line.qty),
            unitCost: Number(line.unitCost),
            taxRate: Number(line.taxRate) || 0,
            ...(line.tracksBatches ? { batchNo: line.batchNo.trim(), expiryDate: line.expiryDate || undefined } : {}),
          })),
        },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 201) throw new Error(apiErrorMessage(res.body, "Failed to save purchase"));
      return res.body;
    },
    onSuccess: (purchase) => {
      setSupplier(emptySupplier);
      setSupplierChoice(emptySupplierChoice);
      setLines([]);
      setError("");
      setSaved(`${purchase.purchaseNo} saved. Stock added, and item costs set to the prices paid.`);
      void queryClient.invalidateQueries({ queryKey: ["purchases", branchId] });
      void queryClient.invalidateQueries({ queryKey: ["stock-module", branchId] });
      void queryClient.invalidateQueries({ queryKey: ["stock-ledger", branchId] });
      void queryClient.invalidateQueries({ queryKey: ["items-stock-list"] });
      void queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    },
    onError: (e) => {
      setSaved("");
      setError((e as Error).message);
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!supplierChoice.supplierId) return setError("Choose the supplier");
    if (supplierChoice.supplierId === NEW_SUPPLIER && !supplierChoice.newName.trim()) return setError("Enter the new supplier's name");
    if (lines.length === 0) return setError("Add at least one item");
    const bad = lines.find((line) => !(Number(line.qty) > 0) || !(Number(line.unitCost) >= 0) || line.unitCost.trim() === "");
    if (bad) return setError(`Enter a quantity and cost for ${bad.name}`);
    const noBatch = lines.find((line) => line.tracksBatches && !line.batchNo.trim());
    if (noBatch) return setError(`Enter the batch number of ${noBatch.name}`);
    create.mutate();
  };

  const updateLine = (itemId: string, patch: Partial<DraftLine>) =>
    setLines((current) => current.map((line) => (line.itemId === itemId ? { ...line, ...patch } : line)));

  return (
    <section className="space-y-6 p-6">
      <form onSubmit={onSubmit} className="card overflow-visible">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 p-5">
          <div>
            <h2 className="page-title">New Purchase</h2>
            <p className="mt-1 text-sm text-slate-500">
              Goods received from a supplier. Quantities are in each item's base unit and costs are per base unit, before tax.
            </p>
          </div>
          <BranchPicker value={branchId} onChange={setManagedBranch} />
        </div>
        <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-4" data-tour="purchases-supplier">
          <SupplierPicker value={supplierChoice} onChange={setSupplierChoice} />
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

        <div className="space-y-3 border-t border-slate-100 p-5" data-tour="purchases-lines">
          <ItemPicker
            items={items.data ?? []}
            excludeIds={lineIds}
            onPick={(item) =>
              setLines((current) => [
                ...current,
                {
                  itemId: item.id,
                  code: item.code,
                  name: item.name,
                  uom: item.uom,
                  qty: "",
                  unitCost: String(Number(item.costPrice) || 0),
                  taxRate: String(Number(item.taxRate) || 0),
                  tracksBatches: item.tracksBatches,
                  batchNo: "",
                  expiryDate: "",
                },
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
                    <th className="py-2">GST %</th>
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
                        {line.tracksBatches ? (
                          <div className="mt-1 flex flex-wrap gap-2">
                            <input
                              className="field w-28 py-1 uppercase"
                              placeholder="Batch no."
                              aria-label={`Batch of ${line.name}`}
                              maxLength={32}
                              value={line.batchNo}
                              onChange={(e) => updateLine(line.itemId, { batchNo: e.target.value })}
                            />
                            <input
                              className="field w-36 py-1"
                              type="date"
                              aria-label={`Expiry of ${line.name}`}
                              title="Expiry date: the last day it may be sold"
                              value={line.expiryDate}
                              onChange={(e) => updateLine(line.itemId, { expiryDate: e.target.value })}
                            />
                          </div>
                        ) : null}
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
                      <td className="py-2 pr-3">
                        <input
                          className="field w-20 py-1"
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          disabled={!supplierCharges}
                          title={supplierCharges ? undefined : "Only a supplier with a GSTIN charges GST"}
                          value={supplierCharges ? line.taxRate : "0"}
                          onChange={(e) => updateLine(line.itemId, { taxRate: e.target.value })}
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
                    <td colSpan={4} className="py-2 text-right font-semibold text-slate-900">
                      Total before tax
                    </td>
                    <td className="py-2 text-right font-semibold tabular-nums text-slate-900">{inr(total)}</td>
                    <td />
                  </tr>
                  {supplierCharges ? (
                    <tr>
                      <td colSpan={4} className="py-1 text-right text-slate-600">
                        GST (input tax credit)
                      </td>
                      <td className="py-1 text-right tabular-nums text-slate-700">{inr(taxTotal)}</td>
                      <td />
                    </tr>
                  ) : null}
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
            <button className="btn-primary" type="submit" data-tour="purchases-save" disabled={create.isPending}>
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

      <div className="card overflow-hidden" data-tour="purchases-recent">
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
                  <span className="text-sm font-semibold tabular-nums text-slate-900">
                    {inr(purchase.totalCost)}
                    {Number(purchase.taxTotal ?? 0) > 0 ? (
                      <span className="block text-right text-xs font-normal text-slate-500">
                        + {inr(purchase.taxTotal)} GST{purchase.itcEligible ? " (ITC)" : ""}
                      </span>
                    ) : null}
                    {purchase.dueDate && !purchase.settledBeforeAccounts ? (
                      <span className="block text-right text-xs font-normal text-slate-500">due {purchase.dueDate}</span>
                    ) : null}
                  </span>
                </button>
                {openId === purchase.id && (
                  <div className="bg-slate-50 px-5 pb-4">
                    <PurchaseDetail purchaseId={purchase.id} branchId={branchId} />
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
