import { useMemo, useState } from "react";
import { IconScan, IconSearch } from "../../components/icons";
import { uploadSrc } from "../../lib/api";
import { inr } from "../route-helpers";
import { formatStockOnHand } from "./cartMath";
import { VariantPicker, type VariantChoice } from "./VariantPicker";

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
} & VariantChoice;

/** A tile: one item (in one unit), or a product whose variants are picked in a grid. */
type Tile<T> = { kind: "item"; choice: T } | { kind: "product"; key: string; choices: T[] };

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
  const [picking, setPicking] = useState<T[] | null>(null);
  // A product's variants (in their base unit) share one tile, where the first of them is.
  const tiles = useMemo(() => {
    const out: Array<Tile<T>> = [];
    const products = new Map<string, Extract<Tile<T>, { kind: "product" }>>();
    for (const choice of items) {
      if (!choice.group || choice.saleUom) {
        out.push({ kind: "item", choice });
        continue;
      }
      const known = products.get(choice.group.id);
      if (known) {
        known.choices.push(choice);
        continue;
      }
      const tile = { kind: "product" as const, key: `group:${choice.group.id}`, choices: [choice] };
      products.set(choice.group.id, tile);
      out.push(tile);
    }
    return out;
  }, [items]);

  return (
    <>
      <div className="shrink-0 space-y-3 border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <IconSearch className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" width={16} height={16} />
            <input
              className="field pl-9"
              placeholder="Search products"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>
          <div className="relative flex-1">
            <IconScan className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" width={16} height={16} />
            <input
              className="field pl-9"
              placeholder="Scan barcode or enter code, then Enter"
              value={scanCode}
              onChange={(e) => onScanCodeChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                onScan();
              }}
            />
          </div>
        </div>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
          {categories.map((category) => (
            <button
              key={category}
              className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold whitespace-nowrap transition-colors ${activeCategory === category ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"}`}
              onClick={() => onCategoryChange(category)}
            >
              {category}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {items.length === 0 ? (
          <div className="grid h-full place-items-center text-center">
            <div>
              <p className="text-sm font-medium text-slate-600">No products found</p>
              <p className="mt-1 text-xs text-slate-500">Try another search or category.</p>
            </div>
          </div>
        ) : null}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
          {tiles.map((tile) => {
            if (tile.kind === "product") return <ProductTile key={tile.key} choices={tile.choices} onHandByItem={onHandByItem} onOpen={() => setPicking(tile.choices)} />;
            const item = tile.choice;
            const availableStock = onHandByItem.get(item.id) ?? 0;
            const stockTone = availableStock <= 0 ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-600";
            return (
              <button
                key={item.choiceKey}
                className="group flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white text-left shadow-xs transition hover:border-brand-300 hover:shadow-md active:scale-[0.98]"
                onClick={() => onAdd(item)}
              >
                <div className="h-24 w-full shrink-0 overflow-hidden border-b border-slate-100 bg-slate-50">
                  {item.imageUrl ? (
                    <img
                      src={uploadSrc(item.imageUrl) ?? undefined}
                      alt={item.name}
                      className="h-full w-full object-scale-down"
                    />
                  ) : null}
                </div>
                <div className="flex flex-1 flex-col p-2.5">
                  <p className="line-clamp-2 min-h-[2.5em] text-[13px] leading-tight font-semibold text-slate-800 group-hover:text-brand-700" title={item.name}>
                    {item.name}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-slate-500">
                    {item.displayUom}
                    {item.saleUom ? ` = ${item.saleUomConversionQty} ${item.uom}` : ""}
                  </p>
                  <div className="mt-auto flex items-center justify-between gap-1 pt-2">
                    <span className="text-sm font-semibold whitespace-nowrap text-slate-900 tabular-nums">
                      {inr(item.sellPrice)}
                    </span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap tabular-nums ${stockTone}`}>
                      {formatStockOnHand(availableStock)} left
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
      {picking ? (
        <VariantPicker
          choices={picking}
          onHandByItem={onHandByItem}
          onClose={() => setPicking(null)}
          onPick={(choice) => {
            onAdd(choice);
            setPicking(null);
          }}
        />
      ) : null}
    </>
  );
}

/** A product with variants: its name, how many, the price range and the stock of them all. */
function ProductTile<T extends GridItem>({ choices, onHandByItem, onOpen }: { choices: T[]; onHandByItem: Map<string, number>; onOpen: () => void }) {
  const first = choices[0];
  const prices = choices.map((choice) => Number(choice.sellPrice) || 0);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const stock = choices.reduce((sum, choice) => sum + (onHandByItem.get(choice.id) ?? 0), 0);
  const image = choices.find((choice) => choice.imageUrl)?.imageUrl;
  return (
    <button
      className="group flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white text-left shadow-xs transition hover:border-brand-300 hover:shadow-md active:scale-[0.98]"
      onClick={onOpen}
    >
      <div className="h-24 w-full shrink-0 overflow-hidden border-b border-slate-100 bg-slate-50">
        {image ? <img src={uploadSrc(image) ?? undefined} alt={first.group?.name} className="h-full w-full object-scale-down" /> : null}
      </div>
      <div className="flex flex-1 flex-col p-2.5">
        <p className="line-clamp-2 min-h-[2.5em] text-[13px] leading-tight font-semibold text-slate-800 group-hover:text-brand-700" title={first.group?.name}>
          {first.group?.name}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-slate-500">
          {choices.length} {first.group?.option2Name ? `${first.group.option1Name.toLowerCase()}s & ${first.group.option2Name.toLowerCase()}s` : `${first.group?.option1Name.toLowerCase()}s`}
        </p>
        <div className="mt-auto flex items-center justify-between gap-1 pt-2">
          <span className="text-sm font-semibold whitespace-nowrap text-slate-900 tabular-nums">{low === high ? inr(low) : `${inr(low)}+`}</span>
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap tabular-nums ${stock <= 0 ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-600"}`}>
            {formatStockOnHand(stock)} left
          </span>
        </div>
      </div>
    </button>
  );
}
