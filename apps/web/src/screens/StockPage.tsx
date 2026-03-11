import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api, authHeaders } from "../lib/api";
import { money, requireSession } from "./route-helpers";

type StockModalType = "opening" | "adjustment" | null;

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function StockPage() {
  const session = requireSession();
  const queryClient = useQueryClient();
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [modalType, setModalType] = useState<StockModalType>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [stockSort, setStockSort] = useState<"desc" | "asc">("desc");
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
      const res = await api.items.list({ query: { activeOnly: true } });
      if (res.status !== 200) throw new Error("Failed to fetch items");
      return res.body;
    },
  });

  const onHand = useQuery({
    queryKey: ["stock-module", session.branchId],
    queryFn: async () => {
      const res = await api.stock.onHand({
        query: { branchId: session.branchId },
      });
      if (res.status !== 200) throw new Error("Failed to fetch stock");
      return res.body;
    },
  });

  const ledger = useQuery({
    queryKey: ["stock-ledger", session.branchId, selectedItemId],
    enabled: Boolean(selectedItemId),
    queryFn: async () => {
      if (!selectedItemId) return [];
      const res = await api.stock.ledger({
        query: { branchId: session.branchId, itemId: selectedItemId },
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
      .slice()
      .sort((a, b) => {
        const aOnHand = onHandByItem.get(a.id) ?? 0;
        const bOnHand = onHandByItem.get(b.id) ?? 0;
        if (aOnHand === bOnHand) {
          return a.name.localeCompare(b.name);
        }
        return stockSort === "desc" ? bOnHand - aOnHand : aOnHand - bOnHand;
      });
  }, [items.data, onHandByItem, searchTerm, stockSort]);

  const selectedItem = useMemo(
    () => items.data?.find((item) => item.id === selectedItemId) ?? null,
    [items.data, selectedItemId],
  );
  const selectedOnHand = selectedItem
    ? (onHandByItem.get(selectedItem.id) ?? 0)
    : 0;

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
          branchId: session.branchId,
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
        queryKey: ["stock-module", session.branchId],
      });
      queryClient.invalidateQueries({
        queryKey: ["stock-ledger", session.branchId, selectedItemId],
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
          branchId: session.branchId,
          itemId: selectedItemId,
          qty: Number(openingQty),
          costPrice: Number(openingCostPrice),
          reason: openingReason,
        },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error("Failed to update opening");
      return res.body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["stock-module", session.branchId],
      });
      queryClient.invalidateQueries({
        queryKey: ["stock-ledger", session.branchId, selectedItemId],
      });
      setModalType(null);
    },
  });

  const adjustment = useMutation({
    mutationFn: async () => {
      if (!selectedItemId) throw new Error("Please select an item");
      const res = await api.stock.adjustment({
        body: {
          branchId: session.branchId,
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
        queryKey: ["stock-module", session.branchId],
      });
      queryClient.invalidateQueries({
        queryKey: ["stock-ledger", session.branchId, selectedItemId],
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
      <section className="grid h-[calc(100vh-48px)] grid-cols-1 xl:grid-cols-[360px_1fr]">
        <aside className="border-r border-slate-200 bg-white p-3">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-600">
            Inventory
          </h3>
          {items.isLoading && (
            <p className="px-2 py-3 text-sm text-slate-500">Loading items...</p>
          )}
          {items.isError && (
            <p className="px-2 py-3 text-sm text-rose-600">
              Could not load items.
            </p>
          )}
          <div className="mb-3 grid gap-2">
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              placeholder="Search by item or code"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
            <label className="flex items-center justify-between text-xs text-slate-500">
              Sort by stock
              <select
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                value={stockSort}
                onChange={(event) =>
                  setStockSort(event.target.value as "desc" | "asc")
                }
              >
                <option value="desc">High to Low</option>
                <option value="asc">Low to High</option>
              </select>
            </label>
          </div>
          <div className="space-y-2 overflow-y-auto">
            {filteredItems.map((item) => {
              const isSelected = item.id === selectedItemId;
              const itemOnHand = onHandByItem.get(item.id) ?? 0;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedItemId(item.id)}
                  className={`w-full rounded-lg border px-3 py-3 text-left transition ${
                    isSelected
                      ? "border-teal-700 bg-teal-50"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                >
                  <p className="font-semibold text-slate-900">{item.name}</p>
                  <p className="text-xs text-slate-500">{item.code}</p>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="text-slate-500">
                      On hand: {itemOnHand}
                    </span>
                    <span className="text-slate-500">
                      Cost: Rs {money(item.costPrice)}
                    </span>
                  </div>
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

        <div className="space-y-4 bg-slate-50 p-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-xl font-semibold text-slate-900">
              Stock Management
            </h2>
            {!selectedItem ? (
              <p className="mt-2 text-sm text-slate-500">
                Select an item from the left to manage stock.
              </p>
            ) : (
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    Selected Item
                  </p>
                  <p className="font-semibold text-slate-900">
                    {selectedItem.name}
                  </p>
                  <p className="text-sm text-slate-500">{selectedItem.code}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    On Hand
                  </p>
                  <p className="font-semibold text-slate-900">
                    {selectedOnHand}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    Default Item Cost
                  </p>
                  <p className="font-semibold text-slate-900">
                    Rs {money(selectedItem.costPrice)}
                  </p>
                </div>
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  openingEntry
                    ? openOpeningEditModal()
                    : openOpeningCreateModal()
                }
                className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white"
                disabled={!selectedItem}
              >
                {openingEntry ? "Edit Opening Stock" : "Add Opening Stock"}
              </button>
              <button
                type="button"
                onClick={() => setModalType("adjustment")}
                className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-white"
                disabled={!selectedItem}
              >
                Stock Adjustment
              </button>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-base font-semibold text-slate-900">
                  Opening History
                </h3>
                {openingEntry && (
                  <button
                    type="button"
                    className="rounded-lg border border-teal-700 px-3 py-1 text-xs font-semibold text-teal-700"
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
                      <tr className="border-b border-slate-200 text-left text-slate-500">
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
                            Rs {money(entry.costPrice)}
                          </td>
                          <td className="py-2">{entry.reason || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="text-base font-semibold text-slate-900">
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
                      <tr className="border-b border-slate-200 text-left text-slate-500">
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
                            Rs {money(entry.costPrice)}
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
        </div>
      </section>

      {modalType && selectedItem && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-xl rounded-xl bg-white p-5 shadow-xl">
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
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    value={openingQty}
                    onChange={(e) => setOpeningQty(e.target.value)}
                    type="number"
                    min="0.001"
                    step="0.001"
                    required
                  />
                </label>
                <label className="block text-sm text-slate-600">
                  Unit Cost (Rs)
                  <input
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
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
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    value={openingReason}
                    onChange={(e) => setOpeningReason(e.target.value)}
                    placeholder="Opening stock setup"
                  />
                </label>
                <button
                  className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white"
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
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
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
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    value={adjustmentQty}
                    onChange={(e) => setAdjustmentQty(e.target.value)}
                    type="number"
                    min="0.001"
                    step="0.001"
                    required
                  />
                </label>
                <label className="block text-sm text-slate-600">
                  Unit Cost (Rs)
                  <input
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
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
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
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
