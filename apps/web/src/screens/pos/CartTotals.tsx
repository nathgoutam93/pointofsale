import { money } from "../route-helpers";

/** Tax, order discount (with its Edit button) and the total. */
export function CartTotals({
  totalTax,
  orderDiscountAmount,
  total,
  onEditOrderDiscount,
}: {
  totalTax: number;
  orderDiscountAmount: number;
  total: number;
  onEditOrderDiscount: () => void;
}) {
  return (
    <div className="border-b border-slate-200 px-3 py-4 text">
      <div className="flex items-center justify-between">
        <p className="text-lg text-slate-500">Taxes:</p>
        <p className="text-lg text-slate-500">{money(totalTax)} ₹</p>
      </div>
      <div className="mt-1 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-lg text-slate-500">Order Discount:</p>
          <button
            className="rounded bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700"
            onClick={onEditOrderDiscount}
          >
            Edit
          </button>
        </div>
        <p className="text-lg text-amber-700">
          {orderDiscountAmount > 0
            ? `- ${money(orderDiscountAmount)} ₹`
            : "—"}
        </p>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-2xl font-semibold leading-none text-slate-700">
          Total:
        </p>
        <p className="text-2xl font-semibold leading-none text-slate-700">
          {money(total)} ₹
        </p>
      </div>
    </div>
  );
}
