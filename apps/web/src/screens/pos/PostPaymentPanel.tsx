import { money } from "../route-helpers";
import type { PostPaymentSummary } from "./types";

/** Shown after checkout: the result, print and send buttons, and New Order. */
export function PostPaymentPanel({
  postPayment,
  receiptContact,
  onReceiptContactChange,
  onMessage,
  onSend,
  onNewOrder,
}: {
  postPayment: PostPaymentSummary;
  receiptContact: string;
  onReceiptContactChange: (value: string) => void;
  onMessage: (message: string) => void;
  onSend: () => void;
  onNewOrder: () => void;
}) {
  return (
    <>
      <div className="flex-1 space-y-4 overflow-y-auto border-b border-slate-200 p-3">
        <div className="rounded-lg border border-emerald-300 bg-emerald-100 p-4 text-center">
          <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-full bg-emerald-600 text-2xl font-bold text-white">
            ✓
          </div>
          <p className="text-4xl font-semibold text-emerald-700">
            {postPayment.paymentLines.length > 0
              ? "Payment Successful"
              : "Credit Sale Created"}
          </p>
          <div className="mt-2 flex items-center justify-center gap-3">
            <p className="text-3xl font-bold text-emerald-800">
              ₹ {money(postPayment.grandTotal)}
            </p>
            <button
              className="rounded bg-emerald-500 px-3 py-1 text-sm font-semibold text-white"
              onClick={() =>
                onMessage(
                  postPayment.paymentLines.length > 0
                    ? "Payment already settled. Start a new order."
                    : "Sale saved on full credit. Settle it from Sales.",
                )
              }
            >
              Edit Payment
            </button>
          </div>
        </div>

        <button
          className="w-full rounded border border-slate-200 bg-slate-50 px-4 py-4 text-3xl text-slate-700 print:hidden"
          onClick={() => window.print()}
        >
          {postPayment.paymentLines.length > 0
            ? "Print Full Receipt"
            : "Print Invoice"}
        </button>

        <div className="flex overflow-hidden rounded border border-slate-300">
          <input
            className="w-full px-3 py-3 text-lg text-slate-700 outline-none"
            placeholder="Send receipt to whatsapp"
            value={receiptContact}
            onChange={(e) => onReceiptContactChange(e.target.value)}
          />
          <button
            className="w-20 bg-fuchsia-800 text-2xl text-white"
            onClick={onSend}
          >
            ➤
          </button>
        </div>
      </div>

      <button
        className="m-3 rounded bg-fuchsia-900 px-3 py-5 text-4xl font-semibold text-white"
        onClick={onNewOrder}
      >
        New Order
      </button>
    </>
  );
}
