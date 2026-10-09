import type { StockMutations } from "./useStockMutations";
import type { BatchEntry, StockItem, StockModalType } from "./types";

/** The opening stock (new or changed) or stock adjustment form for the selected item. */
export function StockEntryModal({
  modalType,
  setModalType,
  selectedItem,
  selectedLeastCountStep,
  openingModalMode,
  openingQty,
  setOpeningQty,
  openingCostPrice,
  setOpeningCostPrice,
  openingReason,
  setOpeningReason,
  adjustmentDirection,
  setAdjustmentDirection,
  adjustmentQty,
  setAdjustmentQty,
  adjustmentCostPrice,
  setAdjustmentCostPrice,
  adjustmentReason,
  setAdjustmentReason,
  opening,
  updateOpening,
  adjustment,
  batch,
  setBatch,
}: {
  modalType: NonNullable<StockModalType>;
  setModalType: (type: StockModalType) => void;
  selectedItem: StockItem;
  selectedLeastCountStep: string;
  openingModalMode: "create" | "edit";
  openingQty: string;
  setOpeningQty: (qty: string) => void;
  openingCostPrice: string;
  setOpeningCostPrice: (costPrice: string) => void;
  openingReason: string;
  setOpeningReason: (reason: string) => void;
  adjustmentDirection: "IN" | "OUT";
  setAdjustmentDirection: (direction: "IN" | "OUT") => void;
  adjustmentQty: string;
  setAdjustmentQty: (qty: string) => void;
  adjustmentCostPrice: string;
  setAdjustmentCostPrice: (costPrice: string) => void;
  adjustmentReason: string;
  setAdjustmentReason: (reason: string) => void;
  opening: StockMutations["opening"];
  updateOpening: StockMutations["updateOpening"];
  adjustment: StockMutations["adjustment"];
  batch: BatchEntry;
  setBatch: (batch: BatchEntry) => void;
}) {
  // Items kept by batch: which batch (stock out may leave it blank: earliest expiry first).
  const batchFields = (required: boolean, withExpiry: boolean) =>
    selectedItem.tracksBatches ? (
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm text-slate-600">
          Batch no.{required ? "" : <span className="text-slate-400"> (blank: earliest expiry first)</span>}
          <input className="field mt-1 uppercase" maxLength={32} value={batch.batchNo} required={required} onChange={(e) => setBatch({ ...batch, batchNo: e.target.value })} />
        </label>
        {withExpiry ? (
          <label className="block text-sm text-slate-600">
            Expiry date
            <input className="field mt-1" type="date" value={batch.expiryDate} onChange={(e) => setBatch({ ...batch, expiryDate: e.target.value })} />
          </label>
        ) : null}
      </div>
    ) : null;
  return (
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
            {batchFields(true, true)}
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
                {(opening.error ?? updateOpening.error)?.message ||
                  (openingModalMode === "edit" ? "Could not update opening stock entry." : "Could not save opening stock entry.")}
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
            {batchFields(adjustmentDirection === "IN", adjustmentDirection === "IN")}
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
                {adjustment.error?.message || "Could not save stock adjustment entry."}
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
