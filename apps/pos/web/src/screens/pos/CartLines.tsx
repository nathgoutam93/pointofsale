import { IconMinus, IconPlus, IconTrash } from "../../components/icons";
import { uploadSrc } from "../../lib/api";
import { inr, money } from "../route-helpers";
import { computeLineAmounts, formatQty, formatStockOnHand, getCartLineKey } from "./cartMath";
import type { CartLine } from "./types";

const stepButton =
  "grid h-7 w-7 place-items-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900";

/** The cart's lines, each with its total, stock warning and -, + and remove buttons. */
export function CartLines({
  cart,
  onHandByItem,
  chargeTax,
  onOpen,
  onStep,
  onRemove,
}: {
  cart: CartLine[];
  onHandByItem: Map<string, number>;
  chargeTax: boolean;
  onOpen: (line: CartLine) => void;
  onStep: (line: CartLine, direction: 1 | -1) => void;
  onRemove: (line: CartLine) => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto border-b border-slate-200" data-tour="pos-cart">
      {cart.length === 0 ? (
        <div className="grid h-full place-items-center p-6 text-center">
          <div>
            <p className="text-sm font-medium text-slate-600">Cart is empty</p>
            <p className="mt-1 text-xs text-slate-500">Pick products on the right or scan a barcode.</p>
          </div>
        </div>
      ) : null}
      {cart.map((line) => {
        const lineNet = computeLineAmounts(line, chargeTax).net;
        const itemDiscount =
          line.itemDiscountAmount ?? line.discountAmount;
        const availableStock = onHandByItem.get(line.itemId);
        const isLowStock =
          availableStock !== undefined && line.qty > availableStock;
        return (
          <div
            className="flex cursor-pointer items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 hover:bg-slate-50"
            key={getCartLineKey(line)}
            onClick={() => onOpen(line)}
          >
            <div className="flex min-w-0 gap-3">
              <div className="h-11 w-11 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50">
                {line.imageUrl ? (
                  <img
                    src={uploadSrc(line.imageUrl) ?? undefined}
                    alt={line.name}
                    className="h-full w-full object-cover"
                  />
                ) : null}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">
                  {line.name}
                </p>
                <p className="text-xs text-slate-500 tabular-nums">
                  {line.saleUom
                    ? `${line.saleUomQty ?? 1} ${line.saleUom} (${formatQty(line.qty, line.leastCount)})`
                    : formatQty(line.qty, line.leastCount)}{" "}
                  × {money(line.rate)}
                </p>
                {isLowStock ? (
                  <p className="mt-0.5 text-xs font-medium text-rose-600">
                    Only {formatStockOnHand(availableStock ?? 0)} in stock
                  </p>
                ) : null}
                {itemDiscount > 0 ? (
                  <p className="mt-0.5 text-xs text-amber-700">
                    Discount {inr(itemDiscount)}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-base font-semibold text-slate-900 tabular-nums">
                {inr(lineNet)}
              </p>
              <div className="mt-1.5 flex justify-end gap-1">
                <button
                  className={stepButton}
                  aria-label="Decrease quantity"
                  onClick={(event) => {
                    event.stopPropagation();
                    onStep(line, -1);
                  }}
                >
                  <IconMinus width={14} height={14} />
                </button>
                <button
                  className={stepButton}
                  aria-label="Increase quantity"
                  onClick={(event) => {
                    event.stopPropagation();
                    onStep(line, 1);
                  }}
                >
                  <IconPlus width={14} height={14} />
                </button>
                <button
                  className="grid h-7 w-7 place-items-center rounded-md border border-rose-200 bg-white text-rose-600 hover:bg-rose-50"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemove(line);
                  }}
                  title="Remove item"
                  aria-label="Remove item"
                >
                  <IconTrash width={14} height={14} />
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
