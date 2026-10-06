import { useQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { LABEL_LAYOUT_IDS, LABEL_LAYOUTS, labelProblem, labelsHtml, priceWithTax, type LabelData, type LabelLayoutId } from "@pos/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { BranchPicker } from "../components/BranchPicker";
import { api, authHeaders } from "../lib/api";
import { useManagedBranch } from "../lib/branch";
import { requireManagementSession } from "./route-helpers";
import { useStoreSettings } from "./pos/useStoreSettings";
import { useBatches } from "./stock/useBatches";

type Item = { id: string; code: string; name: string; uom: string; sellPrice: number; mrp: number; taxMode: "INCLUSIVE" | "EXCLUSIVE"; taxRate: number; tracksBatches: boolean; saleUoms: Array<{ uom: string; sellPrice: number; mrp: number }>; barcodes: Array<{ barcode: string; saleUom: string | null }> };
type Line = { key: string; itemId: string; uom: string | null; barcode: string; batchNo: string | null; expiryDate: string | null; copies: number };

const LAYOUT_KEY = "pos_label_layout";
const readLayout = (): LabelLayoutId => {
  try {
    const saved = localStorage.getItem(LAYOUT_KEY);
    return saved && saved in LABEL_LAYOUTS ? (saved as LabelLayoutId) : "ROLL_50X25";
  } catch {
    return "ROLL_50X25";
  }
};

/** The barcodes an item can be scanned by in a unit (null: its base unit), its code last. */
function barcodeChoices(item: Item, uom: string | null) {
  const own = item.barcodes.filter((entry) => (entry.saleUom ?? null)?.toLowerCase() === uom?.toLowerCase() || (!entry.saleUom && !uom)).map((entry) => entry.barcode);
  return uom ? own : [...own, item.code];
}

/** Prints a document from a hidden frame, so the page size is the labels' own. */
function printDocument(html: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 60_000);
  };
  frame.srcdoc = html;
  document.body.appendChild(frame);
}

/**
 * Barcode labels for goods: pick items (or start from a purchase), how many of each, and print
 * on a label roll or A4 sticker sheets. An item without a barcode gets its item code, which the
 * counter scans the same way.
 */
export function LabelsPage() {
  requireManagementSession();
  const search = useSearch({ from: "/labels" });
  const [managedBranch, setManagedBranch] = useManagedBranch();
  const branchId = managedBranch ?? "";
  const store = useStoreSettings(branchId);
  const [lines, setLines] = useState<Line[]>([]);
  const [term, setTerm] = useState("");
  const [layoutId, setLayoutId] = useState<LabelLayoutId>(readLayout);
  const [startAt, setStartAt] = useState(1);
  const [showStore, setShowStore] = useState(true);
  const [showPrice, setShowPrice] = useState(true);
  const [showMrp, setShowMrp] = useState(true);
  const [showBatch, setShowBatch] = useState(true);
  const layout = LABEL_LAYOUTS[layoutId];

  const items = useQuery({
    queryKey: ["items-labels", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const res = await api.items.list({ query: { activeOnly: true, branchId }, extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error("Couldn't load items");
      return res.body as Item[];
    },
  });
  const byId = useMemo(() => new Map((items.data ?? []).map((item) => [item.id, item])), [items.data]);

  const newLine = (item: Item, extra: Partial<Line> = {}): Line => ({
    key: crypto.randomUUID(),
    itemId: item.id,
    uom: null,
    barcode: barcodeChoices(item, null)[0],
    batchNo: null,
    expiryDate: null,
    copies: 1,
    ...extra,
  });

  // Started from an item or a purchase: its lines, once the items are loaded.
  const prefilled = useRef(false);
  const purchase = useQuery({
    queryKey: ["purchase-for-labels", search.purchaseId],
    enabled: !!search.purchaseId,
    queryFn: async () => {
      const res = await api.purchases.get({ params: { id: search.purchaseId! }, extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error("Couldn't load the purchase");
      return res.body;
    },
  });
  useEffect(() => {
    if (prefilled.current || !items.data) return;
    if (search.itemId) {
      const item = byId.get(search.itemId);
      if (item) setLines([newLine(item)]);
      prefilled.current = true;
    } else if (search.purchaseId && purchase.data) {
      setLines(
        purchase.data.lines.flatMap((row) => {
          const item = byId.get(row.itemId);
          // One label a piece, for counted goods; one for anything weighed or measured.
          return item ? [newLine(item, { batchNo: row.batch?.batchNo ?? null, expiryDate: row.batch?.expiryDate ?? null, copies: Number.isInteger(row.qty) ? Math.min(row.qty, 500) : 1 })] : [];
        }),
      );
      prefilled.current = true;
    } else if (!search.itemId && !search.purchaseId) {
      prefilled.current = true;
    }
  }, [items.data, purchase.data, search.itemId, search.purchaseId, byId]);

  const needle = term.trim().toLowerCase();
  const matches = needle
    ? (items.data ?? [])
        .filter((item) => item.name.toLowerCase().includes(needle) || item.code.toLowerCase().includes(needle) || item.barcodes.some((entry) => entry.barcode.toLowerCase() === needle))
        .slice(0, 12)
    : [];

  const labels: LabelData[] = useMemo(() => {
    const out: LabelData[] = [];
    for (const line of lines) {
      const item = byId.get(line.itemId);
      if (!item) continue;
      const unit = line.uom ? item.saleUoms.find((entry) => entry.uom === line.uom) : null;
      const sellPrice = Number(unit?.sellPrice ?? item.sellPrice);
      const label: LabelData = {
        name: item.name,
        barcode: line.barcode,
        price: priceWithTax(sellPrice, item.taxMode, Number(item.taxRate), store.chargeTax),
        mrp: Number(unit?.mrp ?? item.mrp) || null,
        unit: line.uom ?? (item.uom.toUpperCase() === "PCS" || item.uom.toUpperCase() === "NOS" ? null : item.uom),
        batchNo: line.batchNo,
        expiryDate: line.expiryDate,
      };
      for (let copy = 0; copy < line.copies; copy += 1) out.push(label);
    }
    return out;
  }, [lines, byId, store.chargeTax]);

  const problems = [...new Set(labels.map(labelProblem).filter(Boolean))] as string[];
  const options = { storeName: showStore ? store.storeDisplayName : null, showPrice, showMrp, showBatch, startAt };
  const html = useMemo(
    () => (labels.length > 0 && problems.length === 0 ? labelsHtml(labels, layoutId, options) : ""),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [labels, layoutId, showStore, showPrice, showMrp, showBatch, startAt, store.storeDisplayName, problems.length],
  );
  // The preview shows the first page or so, to stay quick with hundreds of labels.
  const previewHtml = useMemo(
    () =>
      labels.length > 0 && problems.length === 0
        ? // A whole A4 sheet is shown at half size, to fit beside the list.
          labelsHtml(labels.slice(0, layout.kind === "ROLL" ? 4 : layout.columns * layout.rows), layoutId, options).replace(
            "</head>",
            `<style>@media screen { body { zoom: ${layout.kind === "SHEET" ? 0.5 : 1}; } }</style></head>`,
          )
        : "",
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [labels, layoutId, showStore, showPrice, showMrp, showBatch, startAt, store.storeDisplayName, problems.length],
  );

  const update = (key: string, change: Partial<Line>) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...change } : line)));

  return (
    <section className="grid gap-6 p-6 xl:grid-cols-[1fr_26rem]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="page-title">Barcode Labels</h2>
            <p className="text-sm text-slate-500">Prices are this branch's, with GST. Items without a barcode get their item code, which the counter scans too.</p>
          </div>
          <BranchPicker value={branchId} onChange={setManagedBranch} className="w-56" />
        </div>

        <div className="card p-4" data-tour="labels-add">
          <input className="field" placeholder="Add an item: search by name, code or barcode" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Search items" />
          {matches.length > 0 ? (
            <ul className="mt-2 divide-y divide-slate-100 rounded-md border border-slate-200">
              {matches.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="flex w-full justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50"
                    onClick={() => {
                      setLines((current) => [...current, newLine(item)]);
                      setTerm("");
                    }}
                  >
                    <span className="truncate">{item.name}</span>
                    <span className="shrink-0 text-xs text-slate-500">{item.code}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="card overflow-x-auto" data-tour="labels-lines">
          {lines.length === 0 ? (
            <p className="p-5 text-sm text-slate-500">{purchase.isLoading || items.isLoading ? "Loading…" : "No items yet. Add some above."}</p>
          ) : (
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="eyebrow border-b border-slate-200 text-left">
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2">Unit</th>
                  <th className="px-3 py-2">Barcode</th>
                  <th className="px-3 py-2">Batch</th>
                  <th className="px-3 py-2 text-right">Labels</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const item = byId.get(line.itemId);
                  if (!item) return null;
                  const choices = barcodeChoices(item, line.uom);
                  return (
                    <tr key={line.key} className="border-b border-slate-100 align-top">
                      <td className="px-3 py-2">
                        {item.name} <span className="block text-xs text-slate-500">{item.code}</span>
                      </td>
                      <td className="px-3 py-2">
                        {item.saleUoms.length > 0 ? (
                          <select
                            className="field py-1"
                            value={line.uom ?? ""}
                            aria-label={`Unit for ${item.name}`}
                            onChange={(e) => {
                              const uom = e.target.value || null;
                              update(line.key, { uom, barcode: barcodeChoices(item, uom)[0] ?? "" });
                            }}
                          >
                            <option value="">{item.uom}</option>
                            {item.saleUoms.map((unit) => (
                              <option key={unit.uom} value={unit.uom}>{unit.uom}</option>
                            ))}
                          </select>
                        ) : (
                          item.uom
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {choices.length === 0 ? (
                          <span className="text-xs text-rose-700">No barcode for this unit: add one on the Items screen</span>
                        ) : (
                          <select className="field py-1 font-mono" value={line.barcode} aria-label={`Barcode for ${item.name}`} onChange={(e) => update(line.key, { barcode: e.target.value })}>
                            {choices.map((code) => (
                              <option key={code} value={code}>{code === item.code && !item.barcodes.some((entry) => entry.barcode === code) ? `${code} (item code)` : code}</option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {item.tracksBatches ? <BatchPicker branchId={branchId} itemId={item.id} value={line.batchNo} onChange={(batchNo, expiryDate) => update(line.key, { batchNo, expiryDate })} /> : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          className="field w-20 py-1 text-right"
                          type="number"
                          min="1"
                          max="2000"
                          value={line.copies}
                          aria-label={`Labels of ${item.name}`}
                          onChange={(e) => update(line.key, { copies: Math.max(1, Math.min(2000, Math.floor(Number(e.target.value) || 1))) })}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button type="button" className="text-xs font-medium text-rose-700 hover:underline" onClick={() => setLines((current) => current.filter((other) => other.key !== line.key))}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="card grid gap-3 p-4" data-tour="labels-options">
          <div>
            <label className="field-label" htmlFor="label-layout">Print on</label>
            <select
              id="label-layout"
              className="field"
              value={layoutId}
              onChange={(e) => {
                const next = e.target.value as LabelLayoutId;
                setLayoutId(next);
                setStartAt(1);
                try {
                  localStorage.setItem(LAYOUT_KEY, next);
                } catch {
                  // Remembered for this visit only.
                }
              }}
            >
              {LABEL_LAYOUT_IDS.map((id) => (
                <option key={id} value={id}>{LABEL_LAYOUTS[id].label}</option>
              ))}
            </select>
          </div>
          {layout.kind === "SHEET" ? (
            <div>
              <label className="field-label" htmlFor="label-start">Start at label (on a part-used sheet)</label>
              <input id="label-start" className="field" type="number" min="1" max={layout.columns * layout.rows} value={startAt} onChange={(e) => setStartAt(Math.max(1, Math.min(layout.columns * layout.rows, Math.floor(Number(e.target.value) || 1))))} />
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-2 text-sm text-slate-700">
            <label className="flex items-center gap-2"><input type="checkbox" checked={showStore} onChange={(e) => setShowStore(e.target.checked)} /> Store name</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} /> Price</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={showMrp} onChange={(e) => setShowMrp(e.target.checked)} /> MRP</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={showBatch} onChange={(e) => setShowBatch(e.target.checked)} /> Batch and expiry</label>
          </div>
          {problems.map((problem) => (
            <p key={problem} className="text-sm text-rose-700">{problem}</p>
          ))}
          <button className="btn-primary h-10" type="button" data-tour="labels-print" disabled={!html} onClick={() => printDocument(html)}>
            Print {labels.length} {labels.length === 1 ? "label" : "labels"}
          </button>
          <p className="text-xs text-slate-500">In the print dialog, pick the label printer (or the A4 printer), set margins to none and scale to 100%.</p>
        </div>
        {previewHtml ? (
          <div className="card overflow-hidden">
            <p className="eyebrow border-b border-slate-100 px-4 py-2">Preview{labels.length > 1 && layout.kind === "ROLL" ? " (first labels)" : layout.kind === "SHEET" ? " (first sheet)" : ""}</p>
            <iframe title="Label preview" className="h-[28rem] w-full bg-slate-200" srcDoc={previewHtml} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** The batch a label is for (from the branch's stock), or none. */
function BatchPicker({ branchId, itemId, value, onChange }: { branchId: string; itemId: string; value: string | null; onChange: (batchNo: string | null, expiryDate: string | null) => void }) {
  const batches = useBatches(branchId, { itemId });
  const rows = batches.data ?? [];
  const known = value === null || rows.some((row) => row.batchNo === value);
  return (
    <select
      className="field py-1"
      value={value ?? ""}
      aria-label="Batch"
      onChange={(e) => {
        const row = rows.find((candidate) => candidate.batchNo === e.target.value);
        onChange(row?.batchNo ?? null, row?.expiryDate ?? null);
      }}
    >
      <option value="">No batch</option>
      {!known && value ? <option value={value}>{value}</option> : null}
      {rows.map((row) => (
        <option key={row.batchId} value={row.batchNo}>
          {row.batchNo}{row.expiryDate ? ` · exp ${row.expiryDate}` : ""}
        </option>
      ))}
    </select>
  );
}
