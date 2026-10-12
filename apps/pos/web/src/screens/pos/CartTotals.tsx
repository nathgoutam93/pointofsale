import { inr } from "../route-helpers";

/** Tax, order discount (with its Edit button) and the total. */
export function CartTotals({
  totalTax,
  orderDiscountAmount,
  roundOff,
  total,
  onEditOrderDiscount,
}: {
  totalTax: number;
  orderDiscountAmount: number;
  /** What the total is rounded by (business setting). */
  roundOff: number;
  total: number;
  onEditOrderDiscount: () => void;
}) {
  return (
    <div className="space-y-1.5 border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm" data-tour="pos-totals">
      <div className="flex items-center justify-between text-slate-600">
        <span>Taxes</span>
        <span className="tabular-nums">{inr(totalTax)}</span>
      </div>
      <div className="flex items-center justify-between text-slate-600">
        <span className="flex items-center gap-2">
          Order discount
          <button
            className="rounded px-1 text-xs font-semibold text-brand-600 hover:bg-brand-50 hover:text-brand-700"
            onClick={onEditOrderDiscount}
          >
            Edit
          </button>
        </span>
        <span className={`tabular-nums ${orderDiscountAmount > 0 ? "text-amber-700" : "text-slate-400"}`}>
          {orderDiscountAmount > 0 ? `− ${inr(orderDiscountAmount)}` : "—"}
        </span>
      </div>
      {roundOff !== 0 ? (
        <div className="flex items-center justify-between text-slate-600">
          <span>Round off</span>
          <span className="tabular-nums">{roundOff > 0 ? "+" : "−"} {inr(Math.abs(roundOff))}</span>
        </div>
      ) : null}
      <div className="flex items-baseline justify-between border-t border-slate-200 pt-2">
        <span className="text-sm font-semibold text-slate-900">Total</span>
        <span className="text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">
          {inr(total)}
        </span>
      </div>
    </div>
  );
}
