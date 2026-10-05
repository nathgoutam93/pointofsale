import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api, authHeaders } from "../lib/api";
import { useManagedBranch } from "../lib/branch";
import { can } from "../lib/session";
import { inr, requireManagementSession } from "./route-helpers";
import { BatchesCard } from "./stock/BatchesCard";
import { ExpiryCard } from "./stock/ExpiryCard";
import { MovementsCard } from "./stock/MovementsCard";
import { StockEntryModal } from "./stock/StockEntryModal";
import { leastCountStepText, normalizeLeastCount } from "./stock/stockFormat";
import { StockHistoryCards } from "./stock/StockHistoryCards";
import { StockItemList } from "./stock/StockItemList";
import { emptyBatchEntry, type BatchEntry, type StockModalType } from "./stock/types";
import { useStockMutations } from "./stock/useStockMutations";

export function StockPage() {
  const session = requireManagementSession();
  const [managedBranch, setManagedBranch] = useManagedBranch();
  const branchId = managedBranch ?? "";
  // Opening stock and adjustments: admins, and cashiers allowed to.
  const canChangeStock = can(session, "MANAGE_STOCK");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [modalType, setModalType] = useState<StockModalType>(null);
  const [batch, setBatch] = useState<BatchEntry>(emptyBatchEntry);
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

  // An item's movements a page at a time, newest first.
  const LEDGER_PAGE = 200;
  const ledgerPages = useInfiniteQuery({
    queryKey: ["stock-ledger", branchId, selectedItemId],
    enabled: Boolean(selectedItemId),
    initialPageParam: null as { before: string; beforeId: string } | null,
    queryFn: async ({ pageParam }) => {
      if (!selectedItemId) return [];
      const res = await api.stock.ledger({
        query: { branchId: branchId, itemId: selectedItemId, limit: LEDGER_PAGE, ...(pageParam ?? {}) },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error("Failed to fetch stock history");
      return res.body;
    },
    getNextPageParam: (lastPage) => {
      const last = lastPage[lastPage.length - 1];
      return lastPage.length === LEDGER_PAGE && last ? { before: last.createdAt, beforeId: last.id } : undefined;
    },
  });
  const ledger = useMemo(
    () => ({ data: ledgerPages.data?.pages.flat(), isLoading: ledgerPages.isLoading }),
    [ledgerPages.data, ledgerPages.isLoading],
  );

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
    // Only when another item is picked: a refetch mustn't overwrite what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItem?.id]);

  const { opening, updateOpening, adjustment } = useStockMutations({
    branchId,
    selectedItemId,
    openingQty,
    setOpeningQty,
    openingCostPrice,
    openingReason,
    adjustmentQty,
    setAdjustmentQty,
    adjustmentCostPrice,
    adjustmentReason,
    adjustmentDirection,
    setModalType,
    tracksBatches: !!selectedItem?.tracksBatches,
    batch,
  });
  // Items kept by batch have an opening count per batch, added one at a time (corrected by adjustments).
  const editableOpening = selectedItem?.tracksBatches ? null : openingEntry;

  const openOpeningCreateModal = () => {
    setBatch(emptyBatchEntry);
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
        <StockItemList
          branchId={branchId}
          setManagedBranch={setManagedBranch}
          setModalType={setModalType}
          items={items}
          filteredItems={filteredItems}
          onHandByItem={onHandByItem}
          selectedItemId={selectedItemId}
          setSelectedItemId={setSelectedItemId}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          stockSort={stockSort}
          setStockSort={setStockSort}
          belowZeroCount={belowZeroCount}
          belowZeroOnly={belowZeroOnly}
          setBelowZeroOnly={setBelowZeroOnly}
        />

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
                  editableOpening
                    ? openOpeningEditModal()
                    : openOpeningCreateModal()
                }
                className="btn-primary"
                // With older movements not loaded, whether there is an opening count isn't known yet.
                disabled={!selectedItem || (!editableOpening && !selectedItem.tracksBatches && ledgerPages.hasNextPage)}
              >
                {editableOpening ? "Edit Opening Stock" : selectedItem?.tracksBatches ? "Add Opening Stock (a batch)" : "Add Opening Stock"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setBatch(emptyBatchEntry);
                  setModalType("adjustment");
                }}
                className="btn-secondary"
                disabled={!selectedItem}
              >
                Stock Adjustment
              </button>
            </div>
            ) : null}
          </div>

          {selectedItem ? <BatchesCard branchId={branchId} item={selectedItem} onHand={selectedOnHand} /> : null}

          <StockHistoryCards
            ledger={ledger}
            openingHistory={openingHistory}
            openingEntry={openingEntry}
            adjustmentHistory={adjustmentHistory}
            canChangeStock={canChangeStock && !selectedItem?.tracksBatches}
            openOpeningEditModal={openOpeningEditModal}
          />

          <MovementsCard ledger={ledger} ledgerPages={ledgerPages} />

          <ExpiryCard branchId={branchId} />
        </div>
      </section>

      {modalType && selectedItem && (
        <StockEntryModal
          modalType={modalType}
          setModalType={setModalType}
          selectedItem={selectedItem}
          selectedLeastCountStep={selectedLeastCountStep}
          openingModalMode={openingModalMode}
          openingQty={openingQty}
          setOpeningQty={setOpeningQty}
          openingCostPrice={openingCostPrice}
          setOpeningCostPrice={setOpeningCostPrice}
          openingReason={openingReason}
          setOpeningReason={setOpeningReason}
          adjustmentDirection={adjustmentDirection}
          setAdjustmentDirection={setAdjustmentDirection}
          adjustmentQty={adjustmentQty}
          setAdjustmentQty={setAdjustmentQty}
          adjustmentCostPrice={adjustmentCostPrice}
          setAdjustmentCostPrice={setAdjustmentCostPrice}
          adjustmentReason={adjustmentReason}
          setAdjustmentReason={setAdjustmentReason}
          opening={opening}
          updateOpening={updateOpening}
          adjustment={adjustment}
          batch={batch}
          setBatch={setBatch}
        />
      )}
    </>
  );
}
