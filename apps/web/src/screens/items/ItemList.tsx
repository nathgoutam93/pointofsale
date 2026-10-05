import type { Dispatch, SetStateAction } from "react";
import { inr } from "../route-helpers";
import { initialForm, type Item, type ItemFormState, type SaleUomFormState, type PanelMode } from "./itemForm";

/** The items column: searching, the list, and starting a new item. */
export function ItemList({
  canManageItems,
  items,
  filteredItems,
  searchQuery,
  setSearchQuery,
  selectedItemId,
  setSelectedItemId,
  panelMode,
  setPanelMode,
  setForm,
  setSaleUomRows,
  setBarcodeRows,
  setRemoveImageOnEdit,
  resetMutationErrors,
  itemAboveMrp,
}: {
  canManageItems: boolean;
  items: { isLoading: boolean; isError: boolean; data?: Item[] };
  filteredItems: Item[];
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  selectedItemId: string | null;
  setSelectedItemId: (id: string | null) => void;
  panelMode: PanelMode;
  setPanelMode: (mode: PanelMode) => void;
  setForm: Dispatch<SetStateAction<ItemFormState>>;
  setSaleUomRows: Dispatch<SetStateAction<SaleUomFormState[]>>;
  setBarcodeRows: Dispatch<SetStateAction<Array<{ barcode: string; saleUom: string }>>>;
  setRemoveImageOnEdit: (remove: boolean) => void;
  resetMutationErrors: () => void;
  itemAboveMrp: (item: Item) => boolean;
}) {
  return (
    <aside className="flex h-full max-h-[75vh] flex-col overflow-hidden border-r border-slate-200 bg-white xl:max-h-none">
      <div className="shrink-0 border-b border-slate-200 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="page-title">Items</h2>
        {canManageItems ? (
        <div className="flex gap-1.5">
        <button
          className="btn-secondary"
          type="button"
          title="A product in sizes and/or colours"
          onClick={() => {
            resetMutationErrors();
            setPanelMode("product");
          }}
        >
          Sizes / Colours
        </button>
        <button
          className="btn-primary"
          type="button"
          onClick={() => {
            resetMutationErrors();
            setForm(initialForm);
            setSaleUomRows([]);
            setBarcodeRows([]);
            setPanelMode("create");
            setRemoveImageOnEdit(false);
          }}
        >
          New Item
        </button>
        </div>
        ) : null}
      </div>
      <input
        className="field"
        placeholder="Search by name, code, category, or UOM"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
      />
      </div>

      {items.isLoading && (
        <p className="px-2 py-3 text-sm text-slate-500">Loading items...</p>
      )}
      {items.isError && (
        <p className="px-2 py-3 text-sm text-rose-600">
          Could not load items.
        </p>
      )}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-slate-50 p-3">
        {filteredItems.map((item) => {
          const isSelected =
            selectedItemId === item.id && panelMode !== "create";
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                resetMutationErrors();
                setSelectedItemId(item.id);
                setPanelMode("view");
                setRemoveImageOnEdit(false);
              }}
              className={`list-row ${isSelected ? "is-active" : ""}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{item.name}</p>
                  <p className="text-xs text-slate-500">
                    {item.code}
                    {!item.hsnCode || !item.uqc ? (
                      <span className="badge ml-2 bg-amber-50 text-amber-700">
                        {!item.hsnCode ? "No HSN" : "No GST unit"}
                      </span>
                    ) : null}
                    {itemAboveMrp(item) ? (
                      <span className="badge ml-2 bg-rose-50 text-rose-700" title="Its price with GST is above its MRP; it can't be sold until fixed">
                        Above MRP
                      </span>
                    ) : null}
                  </p>
                </div>
                <span className="text-sm font-semibold text-slate-900 tabular-nums">
                  {inr(item.sellPrice)}
                </span>
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-slate-500">
                <span className="tabular-nums">{Number((item as { mrp?: number }).mrp ?? 0) > 0 ? `MRP ${inr((item as { mrp?: number }).mrp)}` : "No MRP"}</span>
                <span className="badge bg-slate-100 text-slate-600">{item.taxMode}</span>
              </div>
              {!!item.saleUoms?.length && (
                <p className="text-xs text-slate-500">
                  UOMs: {item.saleUoms.map((variant) => variant.uom).join(", ")}
                </p>
              )}
            </button>
          );
        })}
      </div>

      {!items.isLoading && !items.data?.length && (
        <p className="px-2 py-3 text-sm text-slate-500">
          No active items found.
        </p>
      )}
      {!items.isLoading &&
        !!items.data?.length &&
        !filteredItems.length && (
          <p className="px-2 py-3 text-sm text-slate-500">
            No items match your search.
          </p>
        )}
    </aside>
  );
}
