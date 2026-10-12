import { EmailReceipt } from "../../components/EmailReceipt";
import { IconCheck, IconPlus, IconPrinter } from "../../components/icons";
import { inr } from "../route-helpers";
import type { PostPaymentSummary } from "./types";

/** Shown after checkout: the result, print, email and download, and New Order. */
export function PostPaymentPanel({
  postPayment,
  onDownload,
  onPrint,
  printing,
  onNewOrder,
}: {
  postPayment: PostPaymentSummary;
  /** Saves the receipt as a file, to share on WhatsApp or anywhere else. */
  onDownload: () => void;
  onPrint: () => void;
  printing: boolean;
  onNewOrder: () => void;
}) {
  const paid = postPayment.paymentLines.length > 0;
  const change = postPayment.paymentLines.reduce(
    (sum, line) => sum + (line.tendered && line.tendered > line.amount ? line.tendered - line.amount : 0),
    0,
  );
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
          {change > 0 ? (
            <p className="mt-3 rounded-md bg-white px-3 py-2 text-lg font-semibold text-emerald-800 tabular-nums">
              Give back {inr(change)} change
            </p>
          ) : null}
        </div>

        <button className="btn-secondary h-11 w-full print:hidden" onClick={onPrint} disabled={printing}>
          <IconPrinter />
          {printing ? "Printing…" : paid ? "Print Full Receipt" : "Print Invoice"}
        </button>

        <EmailReceipt key={postPayment.invoiceId} invoiceId={postPayment.invoiceId} defaultEmail={postPayment.customerEmail} />

        <button className="btn-ghost w-full text-sm print:hidden" onClick={onDownload}>
          Download the receipt (to share on WhatsApp)
        </button>
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
