import { money } from "../route-helpers";
import { computeLineAmounts, formatQty, formatStockOnHand, getCartLineKey } from "./cartMath";
import type { TaxCalculationMode } from "./cartMath";
import type { CartLine } from "./types";

/** The cart's lines, each with its total, stock warning and -, + and remove buttons. */
export function CartLines({
  cart,
  onHandByItem,
  taxCalculationMode,
  onOpen,
  onStep,
  onRemove,
}: {
  cart: CartLine[];
  onHandByItem: Map<string, number>;
  taxCalculationMode: TaxCalculationMode;
  onOpen: (line: CartLine) => void;
  onStep: (line: CartLine, direction: 1 | -1) => void;
  onRemove: (line: CartLine) => void;
}) {
  return (
    <div className="flex-1 overflow-y-scroll border-b border-slate-200">
      {cart.length === 0 ? (
        <p className="p-4 text-sm text-slate-500">
          Add products from the right to start an order.
        </p>
      ) : null}
      {cart.map((line) => {
        const lineNet = computeLineAmounts(line, taxCalculationMode).net;
        const itemDiscount =
          line.itemDiscountAmount ?? line.discountAmount;
        const availableStock = onHandByItem.get(line.itemId);
        const isLowStock =
          availableStock !== undefined && line.qty > availableStock;
        return (
          <div
            className="flex cursor-pointer items-start justify-between border-b border-slate-100 px-3 py-2 hover:bg-slate-50"
            key={getCartLineKey(line)}
            onClick={() => onOpen(line)}
          >
            <div className="flex gap-2">
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded bg-slate-100">
                {line.imageUrl ? (
                  <img
                    src={line.imageUrl}
                    alt={line.name}
                    className="h-full w-full object-cover"
                  />
                ) : null}
              </div>
              <div>
                <p className="text-[20px] font-semibold leading-tight text-slate-800">
                  {line.name}
                </p>
                <p className="text-base text-slate-500">
                  {line.saleUom
                    ? `${line.saleUomQty ?? 1} ${line.saleUom} (${formatQty(line.qty, line.leastCount)})`
                    : formatQty(line.qty, line.leastCount)}{" "}
                  x {money(line.rate)}
                </p>
                {isLowStock ? (
                  <p className="text-sm font-semibold text-red-600">
                    Stock on hand {formatStockOnHand(availableStock ?? 0)}
                  </p>
                ) : null}
                {itemDiscount > 0 ? (
                  <p className="text-sm text-amber-700">
                    Item Discount: ₹ {money(itemDiscount)}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="text-right">
              <p className="text-[26px] font-bold leading-none text-slate-800">
                {money(lineNet)} ₹
              </p>
              <div className="mt-1 flex justify-end gap-1">
                <button
                  className="h-7 w-7 rounded bg-slate-200 p-0 text-sm text-slate-700"
                  onClick={(event) => {
                    event.stopPropagation();
                    onStep(line, -1);
                  }}
                >
                  -
                </button>
                <button
                  className="h-7 w-7 rounded bg-slate-200 p-0 text-sm text-slate-700"
                  onClick={(event) => {
                    event.stopPropagation();
                    onStep(line, 1);
                  }}
                >
                  +
                </button>
                <button
                  className="h-7 w-7 rounded bg-rose-200 p-0 text-sm font-bold text-rose-700"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemove(line);
                  }}
                  title="Remove item"
                >
                  x
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
