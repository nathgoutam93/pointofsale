import { money } from "../route-helpers";
import { formatStockOnHand } from "./cartMath";

type GridItem = {
  id: string;
  choiceKey: string;
  name: string;
  uom: string;
  displayUom: string;
  sellPrice: number | string;
  imageUrl?: string | null;
  saleUom?: string;
  saleUomConversionQty: number | string;
};

/** Category tabs, product search, the barcode box and the product tiles. */
export function ProductGrid<T extends GridItem>({
  categories,
  activeCategory,
  onCategoryChange,
  search,
  onSearchChange,
  scanCode,
  onScanCodeChange,
  onScan,
  items,
  onHandByItem,
  onAdd,
}: {
  categories: string[];
  activeCategory: string;
  onCategoryChange: (category: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  scanCode: string;
  onScanCodeChange: (value: string) => void;
  onScan: () => void;
  items: T[];
  onHandByItem: Map<string, number>;
  onAdd: (item: T) => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 p-2">
        <div className="flex flex-wrap gap-1">
          {categories.map((category) => (
            <button
              key={category}
              className={`rounded px-3 py-2 text-sm font-semibold ${activeCategory === category ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-700"}`}
              onClick={() => onCategoryChange(category)}
            >
              {category}
            </button>
          ))}
        </div>
        <input
          className="w-full max-w-72 rounded-full border border-slate-300 px-4 py-2 text-sm"
          placeholder="Search Products"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        <input
          className="w-full max-w-72 rounded-full border border-emerald-300 px-4 py-2 text-sm outline-none focus:border-emerald-500"
          placeholder="Scan barcode / code"
          value={scanCode}
          onChange={(e) => onScanCodeChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            onScan();
          }}
        />
      </div>

      <div className="grid max-h-[calc(100vh-150px)] grid-cols-2 gap-2 overflow-auto p-2 sm:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-8">
        {items.map((item) => {
          const availableStock = onHandByItem.get(item.id) ?? 0;
          return (
            <button
              key={item.choiceKey}
              className="rounded border border-slate-200 bg-white p-2 text-left hover:bg-slate-50"
              onClick={() => onAdd(item)}
            >
              <div className="mb-2 h-20 overflow-hidden rounded bg-slate-100">
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt={item.name}
                    className="h-full w-full object-scale-down"
                  />
                ) : null}
              </div>
              <p className="truncate text-sm font-semibold text-slate-800">
                {item.name}
              </p>
              <p className="truncate text-xs font-medium text-slate-500">
                {item.displayUom}
                {item.saleUom ? ` = ${item.saleUomConversionQty} ${item.uom}` : ""}
              </p>
              <div className="mt-1 flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-emerald-700">
                  Rs {money(item.sellPrice)}
                </span>
                <span className="truncate text-slate-500">
                  Stock: {formatStockOnHand(availableStock)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}
