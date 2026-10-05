import { BranchPicker } from "../../components/BranchPicker";
import { inr } from "../route-helpers";
import type { StockItem, StockModalType } from "./types";

/** The items column: the branch, searching and sorting by stock, and each item's count. */
export function StockItemList({
  branchId,
  setManagedBranch,
  setModalType,
  items,
  filteredItems,
  onHandByItem,
  lowItemIds,
  selectedItemId,
  setSelectedItemId,
  searchTerm,
  setSearchTerm,
  stockSort,
  setStockSort,
  belowZeroCount,
  belowZeroOnly,
  setBelowZeroOnly,
}: {
  branchId: string;
  setManagedBranch: (branchId: string) => void;
  setModalType: (type: StockModalType) => void;
  items: { isLoading: boolean; isError: boolean };
  filteredItems: StockItem[];
  onHandByItem: Map<string, number>;
  /** At or below their reorder level at this branch. */
  lowItemIds: Set<string>;
  selectedItemId: string | null;
  setSelectedItemId: (id: string | null) => void;
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  stockSort: "desc" | "asc";
  setStockSort: (sort: "desc" | "asc") => void;
  belowZeroCount: number;
  belowZeroOnly: boolean;
  setBelowZeroOnly: (only: boolean) => void;
}) {
  return (
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
                <span className={`badge tabular-nums ${itemOnHand <= 0 ? "bg-rose-50 text-rose-700" : lowItemIds.has(item.id) ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-700"}`}>
                  {itemOnHand < 0 ? `${itemOnHand} · below zero` : `${itemOnHand} on hand${lowItemIds.has(item.id) ? " · low" : ""}`}
                </span>
              </div>
              {item.costPrice !== null ? (
                <p className="mt-1.5 text-xs text-slate-500">
                  Cost <span className="tabular-nums">{inr(item.costPrice)}</span>
                </p>
              ) : null}
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
  );
}
