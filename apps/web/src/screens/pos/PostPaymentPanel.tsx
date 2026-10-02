import { IconCheck, IconPlus, IconPrinter, IconSend } from "../../components/icons";
import { inr } from "../route-helpers";
import type { PostPaymentSummary } from "./types";

/** Shown after checkout: the result, print and send buttons, and New Order. */
export function PostPaymentPanel({
  postPayment,
  receiptContact,
  onReceiptContactChange,
  onSend,
  onNewOrder,
}: {
  postPayment: PostPaymentSummary;
  receiptContact: string;
  onReceiptContactChange: (value: string) => void;
  onSend: () => void;
  onNewOrder: () => void;
}) {
  const paid = postPayment.paymentLines.length > 0;
  return (
    <>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-center">
          <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-emerald-600 text-white">
            <IconCheck width={22} height={22} strokeWidth={2.5} />
          </div>
          <p className="text-sm font-semibold text-emerald-800">
            {paid ? "Payment successful" : "Credit sale created"}
          </p>
          <p className="mt-1 text-3xl font-semibold tracking-tight text-slate-900 tabular-nums">
            {inr(postPayment.grandTotal)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {paid ? "This sale is settled." : "Saved on full credit. Settle it from Sales."}
          </p>
        </div>

        <button className="btn-secondary h-11 w-full print:hidden" onClick={() => window.print()}>
          <IconPrinter />
          {paid ? "Print Full Receipt" : "Print Invoice"}
        </button>

        <div>
          <label className="field-label">Send receipt</label>
          <div className="flex gap-2">
            <input
              className="field"
              placeholder="WhatsApp number"
              value={receiptContact}
              onChange={(e) => onReceiptContactChange(e.target.value)}
            />
            <button className="btn-secondary shrink-0" onClick={onSend} aria-label="Send receipt">
              <IconSend width={16} height={16} />
              Send
            </button>
          </div>
        </div>
      </div>

      <div className="border-t border-slate-200 p-4">
        <button className="btn-primary h-14 w-full text-lg" onClick={onNewOrder}>
          <IconPlus width={20} height={20} />
          New Order
        </button>
      </div>
    </>
  );
}
