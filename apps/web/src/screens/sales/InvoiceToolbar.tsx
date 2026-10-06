import { IconPrinter } from "../../components/icons";
import { StatusBadge } from "../../components/StatusBadge";
import type { CurrentInvoice } from "./types";

/** The bill on show's number and status, with Cancel Invoice, Print and Settle. */
export function InvoiceToolbar({
  title,
  currentInvoice,
  canCancelInvoice,
  cancelInvoice,
  setMessage,
  printing,
  onPrint,
  asA4,
  onToggleA4,
  onSettle,
  canTakePayment,
  pendingAmount,
  settlePending,
}: {
  title: string;
  currentInvoice: CurrentInvoice | null;
  /** Whether the bill is an unpaid draft from today this user may cancel. */
  canCancelInvoice: boolean;
  cancelInvoice: {
    isPending: boolean;
    mutate: (payload: { invoiceId: string; reason: string }) => void;
  };
  setMessage: (message: string) => void;
  printing: boolean;
  onPrint: () => void;
  /** The bill is shown (and printed) as an A4 invoice instead of on the branch's paper. */
  asA4: boolean;
  onToggleA4: () => void;
  onSettle: () => void;
  /** Payments are taken only at the branch where this user's register is open. */
  canTakePayment: boolean;
  /** What is still owed on the bill. */
  pendingAmount: number;
  settlePending: boolean;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-3 print:hidden">
      <div className="flex min-w-0 items-center gap-3">
        <h2 className="page-title truncate">
          {title}
        </h2>
        {currentInvoice ? <StatusBadge status={currentInvoice.status} /> : null}
      </div>
      <div className="flex items-center gap-2" data-tour="sales-actions">
        {canCancelInvoice ? (
          <button
            className="btn-danger"
            disabled={cancelInvoice.isPending}
            onClick={() => {
              if (!currentInvoice) return;
              const reason = window.prompt(
                `Cancel ${currentInvoice.invoiceNo}? Nothing has been paid; its stock will be put back.\n\nWhy is it cancelled?`,
              );
              if (reason === null) return;
              if (reason.trim().length < 3) {
                setMessage("Say why the bill is cancelled.");
                return;
              }
              cancelInvoice.mutate({ invoiceId: currentInvoice.id, reason: reason.trim() });
            }}
          >
            Cancel Invoice
          </button>
        ) : null}
        <button
          className={asA4 ? "btn-primary" : "btn-secondary"}
          aria-pressed={asA4}
          title="Show and print this bill as a full-page A4 invoice"
          onClick={onToggleA4}
        >
          A4
        </button>
        <button
          className="btn-secondary"
          disabled={printing}
          onClick={onPrint}
        >
          <IconPrinter width={16} height={16} />
          {printing ? "Printing…" : "Print"}
        </button>
        <button
          className="btn-primary"
          onClick={onSettle}
          title={canTakePayment ? undefined : "Open a register at this branch to take payments"}
          disabled={
            !canTakePayment ||
            !currentInvoice ||
            pendingAmount <= 0 ||
            currentInvoice.status === "CANCELLED" ||
            settlePending
          }
        >
          Settle
        </button>
      </div>
    </div>
  );
}
