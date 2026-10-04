import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api, apiErrorMessage, authHeaders } from "../lib/api";
import { BranchPicker } from "../components/BranchPicker";
import { useManagedBranch } from "../lib/branch";
import { can } from "../lib/session";
import { inr, requireManagementSession } from "./route-helpers";

type StockModalType = "opening" | "adjustment" | null;

const MOVEMENT_LABELS: Record<string, string> = {
  OPENING: "Opening",
  ADJUSTMENT_PLUS: "Adjustment in",
  ADJUSTMENT_MINUS: "Adjustment out",
  SALE: "Sale",
  RETURN: "Return",
  SALE_CANCEL: "Sale cancelled",
  PURCHASE: "Purchase",
  TRANSFER_OUT: "Sent to branch",
  TRANSFER_IN: "Received from branch",
  TRANSFER_CANCEL: "Transfer cancelled",
};

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeLeastCount(value: number | string | null | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  const rounded = Math.round(parsed * 1000) / 1000;
  return rounded >= 0.001 ? rounded : 1;
}

function leastCountStepText(value: number) {
  return normalizeLeastCount(value)
    .toFixed(3)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
}

export function StockPage() {
  const session = requireManagementSession();
  const [managedBranch, setManagedBranch] = useManagedBranch();
  const branchId = managedBranch ?? "";
  // Opening stock and adjustments: admins, and cashiers allowed to.
  const canChangeStock = can(session, "MANAGE_STOCK");
  const queryClient = useQueryClient();
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [modalType, setModalType] = useState<StockModalType>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [stockSort, setStockSort] = useState<"desc" | "asc">("desc");
  // Items sold past their stock count (when the business allows it): to count and correct.
  const [belowZeroOnly, setBelowZeroOnly] = useState(false);
  const [openingModalMode, setOpeningModalMode] = useState<"create" | "edit">(
    "create",
  );
  const [openingQty, setOpeningQty] = useState("0");
  const [openingCostPrice, setOpeningCostPrice] = useState("0");
  const [openingReason, setOpeningReason] = useState("Opening stock");
  const [adjustmentQty, setAdjustmentQty] = useState("0");
  const [adjustmentCostPrice, setAdjustmentCostPrice] = useState("0");
  const [adjustmentReason, setAdjustmentReason] = useState(
    "Manual stock adjustment",
  );
  const [adjustmentDirection, setAdjustmentDirection] = useState<"IN" | "OUT">(
    "IN",
  );

  const items = useQuery({
    queryKey: ["items-stock-list"],
    queryFn: async () => {
      const res = await api.items.list({ query: { activeOnly: true }, extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error("Failed to fetch items");
      return res.body;
    },
  });

  const onHand = useQuery({
    queryKey: ["stock-module", branchId],
    queryFn: async () => {
      const res = await api.stock.onHand({
        query: { branchId: branchId },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error("Failed to fetch stock");
      return res.body;
    },
  });

  const ledger = useQuery({
    queryKey: ["stock-ledger", branchId, selectedItemId],
    enabled: Boolean(selectedItemId),
    queryFn: async () => {
      if (!selectedItemId) return [];
      const res = await api.stock.ledger({
        query: { branchId: branchId, itemId: selectedItemId },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error("Failed to fetch stock history");
      return res.body;
    },
  });

  const onHandByItem = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of onHand.data ?? []) {
      map.set(row.itemId, row.onHand);
    }
    return map;
  }, [onHand.data]);

  const filteredItems = useMemo(() => {
    const data = items.data ?? [];
    const term = searchTerm.trim().toLowerCase();
    const filtered = term
      ? data.filter((item) => {
          const name = item.name.toLowerCase();
          const code = item.code?.toLowerCase() ?? "";
          return name.includes(term) || code.includes(term);
        })
      : data;

    return filtered
      .filter((item) => !belowZeroOnly || (onHandByItem.get(item.id) ?? 0) < 0)
      .slice()
      .sort((a, b) => {
        const aOnHand = onHandByItem.get(a.id) ?? 0;
        const bOnHand = onHandByItem.get(b.id) ?? 0;
        if (aOnHand === bOnHand) {
          return a.name.localeCompare(b.name);
        }
        return stockSort === "desc" ? bOnHand - aOnHand : aOnHand - bOnHand;
      });
  }, [items.data, onHandByItem, searchTerm, stockSort, belowZeroOnly]);
  const belowZeroCount = useMemo(
    () => (onHand.data ?? []).filter((row) => row.onHand < 0).length,
    [onHand.data],
  );

  const selectedItem = useMemo(
    () => items.data?.find((item) => item.id === selectedItemId) ?? null,
    [items.data, selectedItemId],
  );
  const selectedOnHand = selectedItem
    ? (onHandByItem.get(selectedItem.id) ?? 0)
    : 0;
  const selectedLeastCount = normalizeLeastCount(selectedItem?.leastCount ?? 1);
  const selectedLeastCountStep = leastCountStepText(selectedLeastCount);

  const openingHistory = useMemo(
    () => (ledger.data ?? []).filter((entry) => entry.txnType === "OPENING"),
    [ledger.data],
  );
  const openingEntry = openingHistory[0] ?? null;
  const adjustmentHistory = useMemo(
    () =>
      (ledger.data ?? []).filter(
        (entry) =>
          entry.txnType === "ADJUSTMENT_PLUS" ||
          entry.txnType === "ADJUSTMENT_MINUS",
      ),
    [ledger.data],
  );

  useEffect(() => {
    if (!items.data?.length) {
      setSelectedItemId(null);
      return;
    }

    if (
      !selectedItemId ||
      !items.data.some((item) => item.id === selectedItemId)
    ) {
      setSelectedItemId(items.data[0].id);
    }
  }, [items.data, selectedItemId]);

  useEffect(() => {
    if (!selectedItem) return;
    setOpeningCostPrice(String(Number(selectedItem.costPrice) || 0));
    setAdjustmentCostPrice(String(Number(selectedItem.costPrice) || 0));
  }, [selectedItem?.id]);

  const opening = useMutation({
    mutationFn: async () => {
      if (!selectedItemId) throw new Error("Please select an item");
      const res = await api.stock.opening({
        body: {
          branchId: branchId,
          itemId: selectedItemId,
          qty: Number(openingQty),
          costPrice: Number(openingCostPrice),
          reason: openingReason,
        },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 201) throw new Error("Failed to post opening");
      return res.body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["stock-module", branchId],
      });
      queryClient.invalidateQueries({
        queryKey: ["stock-ledger", branchId, selectedItemId],
      });
      setOpeningQty("0");
      setModalType(null);
    },
  });

  const updateOpening = useMutation({
    mutationFn: async () => {
      if (!selectedItemId) throw new Error("Please select an item");
      const res = await api.stock.updateOpening({
        body: {
          branchId: branchId,
          itemId: selectedItemId,
          qty: Number(openingQty),
          costPrice: Number(openingCostPrice),
          reason: openingReason,
        },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "Failed to update opening"));
      return res.body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["stock-module", branchId],
      });
      queryClient.invalidateQueries({
        queryKey: ["stock-ledger", branchId, selectedItemId],
      });
      setModalType(null);
    },
  });

  const adjustment = useMutation({
    mutationFn: async () => {
      if (!selectedItemId) throw new Error("Please select an item");
      const res = await api.stock.adjustment({
        body: {
          branchId: branchId,
          itemId: selectedItemId,
          qty: Number(adjustmentQty),
          direction: adjustmentDirection,
          costPrice: Number(adjustmentCostPrice),
          reason: adjustmentReason,
        },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 201) throw new Error("Failed to post adjustment");
      return res.body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["stock-module", branchId],
      });
      queryClient.invalidateQueries({
        queryKey: ["stock-ledger", branchId, selectedItemId],
      });
      setAdjustmentQty("0");
      setModalType(null);
    },
  });

  const openOpeningCreateModal = () => {
    setOpeningModalMode("create");
    setOpeningQty("0");
    setOpeningCostPrice(String(Number(selectedItem?.costPrice) || 0));
    setOpeningReason("Opening stock");
    setModalType("opening");
  };

  const openOpeningEditModal = () => {
    if (!openingEntry) return;
    setOpeningModalMode("edit");
    setOpeningQty(String(openingEntry.qtyIn));
    setOpeningCostPrice(String(Number(openingEntry.costPrice) || 0));
    setOpeningReason(openingEntry.reason ?? "");
    setModalType("opening");
  };

  return (
    <>
      <section className="grid grid-cols-1 xl:h-[calc(100vh-48px)] xl:grid-cols-[360px_1fr]">
        <aside className="flex h-full max-h-[75vh] flex-col overflow-hidden border-r border-slate-200 bg-white xl:max-h-none">
          <div className="shrink-0 border-b border-slate-200 p-4">
          <h2 className="page-title mb-3">Inventory</h2>
          <BranchPicker
            className="mb-3"
            value={branchId}
            onChange={(next) => {
              setManagedBranch(next);
              setModalType(null);
            }}
          />
          {items.isLoading && (
            <p className="px-2 py-3 text-sm text-slate-500">Loading items...</p>
          )}
          {items.isError && (
            <p className="px-2 py-3 text-sm text-rose-600">
              Could not load items.
            </p>
          )}
          <div className="grid gap-2">
            <input
              className="field"
              placeholder="Search by item or code"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
            <label className="flex items-center justify-between gap-3 text-xs text-slate-500">
              Sort by stock
              <select
                className="field w-auto py-1 text-xs"
                value={stockSort}
                onChange={(event) =>
                  setStockSort(event.target.value as "desc" | "asc")
                }
              >
                <option value="desc">High to Low</option>
                <option value="asc">Low to High</option>
              </select>
            </label>
            {belowZeroCount > 0 ? (
              <label className="flex items-center gap-2 rounded-md bg-rose-50 px-2 py-1.5 text-xs font-medium text-rose-700">
                <input type="checkbox" checked={belowZeroOnly} onChange={(event) => setBelowZeroOnly(event.target.checked)} />
                {belowZeroCount} {belowZeroCount === 1 ? "item is" : "items are"} below zero: count and correct
              </label>
            ) : null}
          </div>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-slate-50 p-3">
            {filteredItems.map((item) => {
              const isSelected = item.id === selectedItemId;
              const itemOnHand = onHandByItem.get(item.id) ?? 0;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedItemId(item.id)}
                  className={`list-row ${isSelected ? "is-active" : ""}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{item.name}</p>
                      <p className="text-xs text-slate-500">{item.code}</p>
                    </div>
                    <span className={`badge tabular-nums ${itemOnHand <= 0 ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-700"}`}>
                      {itemOnHand < 0 ? `${itemOnHand} · below zero` : `${itemOnHand} on hand`}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-slate-500">
                    Cost <span className="tabular-nums">{inr(item.costPrice)}</span>
                  </p>
                </button>
              );
            })}
            {!items.isLoading && filteredItems.length === 0 && (
              <p className="px-2 py-3 text-sm text-slate-500">
                No items match your search.
              </p>
            )}
          </div>
        </aside>

        <div className="space-y-6 overflow-y-auto bg-slate-100 p-6">
          <div className="card p-5">
            <h2 className="page-title">
              {selectedItem ? selectedItem.name : "Stock Management"}
            </h2>
            {!selectedItem ? (
              <p className="mt-2 text-sm text-slate-500">
                Select an item from the left to manage stock.
              </p>
            ) : (
              <dl className="mt-4 grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-3">
                <div>
                  <dt className="eyebrow">Item code</dt>
                  <dd className="mt-1 text-sm font-medium text-slate-900">{selectedItem.code}</dd>
                </div>
                <div>
                  <dt className="eyebrow">On hand</dt>
                  <dd className="mt-1 text-xl font-semibold text-slate-900 tabular-nums">
                    {selectedOnHand}
                  </dd>
                </div>
                <div>
                  <dt className="eyebrow">Default item cost</dt>
                  <dd className="mt-1 text-xl font-semibold text-slate-900 tabular-nums">
                    {inr(selectedItem.costPrice)}
                  </dd>
                </div>
              </dl>
            )}
            {canChangeStock ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  openingEntry
                    ? openOpeningEditModal()
                    : openOpeningCreateModal()
                }
                className="btn-primary"
                disabled={!selectedItem}
              >
                {openingEntry ? "Edit Opening Stock" : "Add Opening Stock"}
              </button>
              <button
                type="button"
                onClick={() => setModalType("adjustment")}
                className="btn-secondary"
                disabled={!selectedItem}
              >
                Stock Adjustment
              </button>
            </div>
            ) : null}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card p-5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900">
                  Opening History
                </h3>
                {openingEntry && canChangeStock && (
                  <button
                    type="button"
                    className="btn-secondary px-2.5 py-1 text-xs"
                    onClick={openOpeningEditModal}
                  >
                    Edit Opening
                  </button>
                )}
              </div>
              {ledger.isLoading && (
                <p className="mt-2 text-sm text-slate-500">
                  Loading history...
                </p>
              )}
              {openingHistory.length === 0 && !ledger.isLoading && (
                <p className="mt-2 text-sm text-slate-500">
                  No opening entries found.
                </p>
              )}
              {openingHistory.length > 0 && (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="eyebrow border-b border-slate-200 text-left">
                        <th className="py-2">Date</th>
                        <th className="py-2">Qty</th>
                        <th className="py-2">Cost</th>
                        <th className="py-2">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {openingHistory.map((entry) => (
                        <tr
                          className="border-b border-slate-100"
                          key={entry.id}
                        >
                          <td className="py-2 pr-2">
                            {formatDateTime(entry.createdAt)}
                          </td>
                          <td className="py-2 pr-2">{entry.qtyIn}</td>
                          <td className="py-2 pr-2">
                            {inr(entry.costPrice)}
                          </td>
                          <td className="py-2">{entry.reason || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="card p-5">
              <h3 className="text-sm font-semibold text-slate-900">
                Adjustment History
              </h3>
              {ledger.isLoading && (
                <p className="mt-2 text-sm text-slate-500">
                  Loading history...
                </p>
              )}
              {adjustmentHistory.length === 0 && !ledger.isLoading && (
                <p className="mt-2 text-sm text-slate-500">
                  No adjustment entries found.
                </p>
              )}
              {adjustmentHistory.length > 0 && (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="eyebrow border-b border-slate-200 text-left">
                        <th className="py-2">Date</th>
                        <th className="py-2">Type</th>
                        <th className="py-2">Qty</th>
                        <th className="py-2">Cost</th>
                        <th className="py-2">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adjustmentHistory.map((entry) => (
                        <tr
                          className="border-b border-slate-100"
                          key={entry.id}
                        >
                          <td className="py-2 pr-2">
                            {formatDateTime(entry.createdAt)}
                          </td>
                          <td className="py-2 pr-2">
                            {entry.txnType === "ADJUSTMENT_PLUS" ? "IN" : "OUT"}
                          </td>
                          <td className="py-2 pr-2">
                            {entry.txnType === "ADJUSTMENT_PLUS"
                              ? entry.qtyIn
                              : entry.qtyOut}
                          </td>
                          <td className="py-2 pr-2">
                            {inr(entry.costPrice)}
                          </td>
                          <td className="py-2">{entry.reason || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="card p-5">
            <h3 className="text-sm font-semibold text-slate-900">
              All Movements
            </h3>
            {ledger.isLoading && (
              <p className="mt-2 text-sm text-slate-500">Loading history...</p>
            )}
            {(ledger.data ?? []).length === 0 && !ledger.isLoading && (
              <p className="mt-2 text-sm text-slate-500">No stock movements yet.</p>
            )}
            {(ledger.data ?? []).length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="eyebrow border-b border-slate-200 text-left">
                      <th className="py-2">Date</th>
                      <th className="py-2">Movement</th>
                      <th className="py-2 text-right">In</th>
                      <th className="py-2 text-right">Out</th>
                      <th className="py-2 pl-4">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(ledger.data ?? []).map((entry) => (
                      <tr className="border-b border-slate-100" key={entry.id}>
                        <td className="py-2 pr-2">{formatDateTime(entry.createdAt)}</td>
                        <td className="py-2 pr-2">{MOVEMENT_LABELS[entry.txnType] ?? entry.txnType}</td>
                        <td className="py-2 pr-2 text-right tabular-nums">{Number(entry.qtyIn) || ""}</td>
                        <td className="py-2 pr-2 text-right tabular-nums">{Number(entry.qtyOut) || ""}</td>
                        <td className="py-2 pl-4 text-slate-600">{entry.reason || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </section>

      {modalType && selectedItem && (
        <div className="modal-backdrop">
          <div className="max-h-[calc(100vh-2rem)] w-full max-w-xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  {modalType === "opening"
                    ? openingModalMode === "edit"
                      ? "Edit Opening Stock"
                      : "Opening Stock Details"
                    : "Stock Adjustment Details"}
                </h3>
                <p className="text-sm text-slate-500">
                  {selectedItem.name} ({selectedItem.code})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalType(null)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600"
              >
                Close
              </button>
            </div>

            {modalType === "opening" ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (openingModalMode === "edit") {
                    updateOpening.mutate();
                    return;
                  }
                  opening.mutate();
                }}
                className="space-y-3"
              >
                <label className="block text-sm text-slate-600">
                  Quantity
                  <input
                    className="field mt-1"
                    value={openingQty}
                    onChange={(e) => setOpeningQty(e.target.value)}
                    type="number"
                    min={selectedLeastCountStep}
                    step={selectedLeastCountStep}
                    required
                  />
                </label>
                <label className="block text-sm text-slate-600">
                  Unit Cost (Rs)
                  <input
                    className="field mt-1"
                    value={openingCostPrice}
                    onChange={(e) => setOpeningCostPrice(e.target.value)}
                    type="number"
                    min="0"
                    step="0.01"
                    required
                  />
                </label>
                <label className="block text-sm text-slate-600">
                  Reason
                  <input
                    className="field mt-1"
                    value={openingReason}
                    onChange={(e) => setOpeningReason(e.target.value)}
                    placeholder="Opening stock setup"
                  />
                </label>
                <button
                  className="btn-primary"
                  type="submit"
                  disabled={opening.isPending || updateOpening.isPending}
                >
                  {opening.isPending || updateOpening.isPending
                    ? "Saving..."
                    : openingModalMode === "edit"
                      ? "Update Opening Stock"
                      : "Save Opening Stock"}
                </button>
                {(opening.isError || updateOpening.isError) && (
                  <p className="text-sm text-rose-600">
                    {openingModalMode === "edit"
                      ? "Could not update opening stock entry."
                      : "Could not save opening stock entry."}
                  </p>
                )}
              </form>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  adjustment.mutate();
                }}
                className="space-y-3"
              >
                <label className="block text-sm text-slate-600">
                  Direction
                  <select
                    className="field mt-1"
                    value={adjustmentDirection}
                    onChange={(e) =>
                      setAdjustmentDirection(e.target.value as "IN" | "OUT")
                    }
                  >
                    <option value="IN">IN (+)</option>
                    <option value="OUT">OUT (-)</option>
                  </select>
                </label>
                <label className="block text-sm text-slate-600">
                  Quantity
                  <input
                    className="field mt-1"
                    value={adjustmentQty}
                    onChange={(e) => setAdjustmentQty(e.target.value)}
                    type="number"
                    min={selectedLeastCountStep}
                    step={selectedLeastCountStep}
                    required
                  />
                </label>
                <label className="block text-sm text-slate-600">
                  Unit Cost (Rs)
                  <input
                    className="field mt-1"
                    value={adjustmentCostPrice}
                    onChange={(e) => setAdjustmentCostPrice(e.target.value)}
                    type="number"
                    min="0"
                    step="0.01"
                    required
                  />
                </label>
                <label className="block text-sm text-slate-600">
                  Reason
                  <input
                    className="field mt-1"
                    value={adjustmentReason}
                    onChange={(e) => setAdjustmentReason(e.target.value)}
                    placeholder="Damage / correction / stock count"
                    required
                  />
                </label>
                <button
                  className="rounded-lg bg-slate-800 px-4 py-2 font-semibold text-white"
                  type="submit"
                  disabled={adjustment.isPending}
                >
                  {adjustment.isPending
                    ? "Saving..."
                    : "Submit Stock Adjustment"}
                </button>
                {adjustment.isError && (
                  <p className="text-sm text-rose-600">
                    Could not save stock adjustment entry.
                  </p>
                )}
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
