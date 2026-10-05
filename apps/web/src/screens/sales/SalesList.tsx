import { invoiceDue } from "@pos/contracts";
import { formatReceiptDate } from "../../lib/receiptFormat";
import { StatusBadge } from "../../components/StatusBadge";
import { inr } from "../route-helpers";
import { isOverdue } from "./salesFormat";
import type { SaleListInvoice, SalesList as SalesListState } from "./useSalesList";

/** The bills matching the filters, newest first, with what is still due on each. */
export function SalesList({
  filteredSales,
  selectedInvoiceId,
  onSelect,
  formatSaleCreator,
  timeZone,
  salesPages,
}: {
  filteredSales: SaleListInvoice[];
  selectedInvoiceId: string;
  onSelect: (invoiceId: string) => void;
  formatSaleCreator: (createdBy: string, createdByName?: string) => string;
  /** The business's time zone, for dates and due dates. */
  timeZone?: string;
  salesPages: SalesListState["salesPages"];
}) {
  return (
    <div className="flex-1 space-y-2 overflow-y-auto bg-slate-50 p-3">
      {filteredSales.map((invoice) => {
        const pending =
          invoiceDue(invoice);
        const isSelected = selectedInvoiceId === invoice.id;
        return (
          <button
            key={invoice.id}
            className={`list-row ${isSelected ? "is-active" : ""}`}
            onClick={() => onSelect(invoice.id)}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">
                  {invoice.invoiceNo}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {formatReceiptDate(invoice.createdAt, timeZone)} ·{" "}
                  {formatSaleCreator(
                    invoice.createdBy,
                    invoice.createdByName,
                  )}
                </p>
              </div>
              <StatusBadge status={invoice.status} />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
              <p>
                Total{" "}
                <span className="font-semibold text-slate-900 tabular-nums">
                  {inr(Number(invoice.grandTotal))}
                </span>
              </p>
              {pending > 0 && invoice.status !== "CANCELLED" ? (
                <p className="font-medium text-amber-700 tabular-nums">
                  Due {inr(pending)}
                  {isOverdue(invoice, pending, timeZone) ? (
                    <span className="ml-1.5 badge bg-rose-50 text-rose-700 ring-1 ring-rose-200 ring-inset">Overdue</span>
                  ) : null}
                </p>
              ) : (
                <p className="tabular-nums">Paid {inr(Number(invoice.paidTotal))}</p>
              )}
            </div>
          </button>
        );
      })}
      {filteredSales.length === 0 && !salesPages.isLoading ? (
        <div className="rounded-md border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          No invoices match the current filters.
        </div>
      ) : null}
      {salesPages.hasNextPage ? (
        <button
          type="button"
          className="btn-secondary w-full"
          disabled={salesPages.isFetchingNextPage}
          onClick={() => void salesPages.fetchNextPage()}
        >
          {salesPages.isFetchingNextPage ? "Loading…" : "Load older bills"}
        </button>
      ) : null}
    </div>
  );
}
