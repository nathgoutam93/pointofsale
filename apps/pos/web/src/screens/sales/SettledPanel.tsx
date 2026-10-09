import { invoiceDue } from "@pos/contracts";
import { EmailReceipt } from "../../components/EmailReceipt";
import { IconCheck } from "../../components/icons";
import { inr } from "../route-helpers";
import type { SettledSummary } from "./types";

/** Shown just after a payment is taken: what was paid, email the receipt, and back to the bills. */
export function SettledPanel({
  settledSummary,
  defaultEmail,
  onBack,
}: {
  settledSummary: SettledSummary;
  /** The customer's saved email, offered by "Email the receipt". */
  defaultEmail?: string | null;
  onBack: () => void;
}) {
  return (
    <>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-center">
          <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-emerald-600 text-white">
            <IconCheck width={22} height={22} strokeWidth={2.5} />
          </div>
          <p className="text-sm font-semibold text-emerald-800">
            {settledSummary.status === "SETTLED"
              ? "Payment successful"
              : "Payment recorded"}
          </p>
          <p className="mt-1 text-3xl font-semibold tracking-tight text-slate-900 tabular-nums">
            {inr(settledSummary.receiptAmount)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {settledSummary.status === "SETTLED"
              ? "Invoice settled"
              : `Remaining ${inr(invoiceDue(settledSummary))}`}
          </p>
        </div>

        <EmailReceipt key={settledSummary.invoiceId} invoiceId={settledSummary.invoiceId} defaultEmail={defaultEmail} />
      </div>

      <div className="border-t border-slate-200 p-4">
        <button className="btn-primary h-11 w-full" onClick={onBack}>
          Back to Invoices
        </button>
      </div>
    </>
  );
}
