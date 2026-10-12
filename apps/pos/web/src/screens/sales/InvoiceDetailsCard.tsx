import { formatReceiptDate } from "../../lib/receiptFormat";
import { inr } from "../route-helpers";
import { formatQtyLabel, getSaleQtyLabel, isOverdue } from "./salesFormat";
import type { CurrentInvoice, InvoiceReceipt, PaymentMode, SaleLine } from "./types";

/** The bill on show: who and what it is for, its lines and totals, its payments and receipts. */
export function InvoiceDetailsCard({
  currentInvoice,
  currentCustomerName,
  currentSaleCreatorId,
  currentSaleCreatorName,
  formatSaleCreator,
  invoiceGrandTotal,
  pendingAmount,
  timeZone,
  saleLines,
  itemUomById,
  invoiceSubTotal,
  invoiceTaxTotal,
  paymentBreakdown,
  receiptsForInvoice,
  previewReceipt,
  onSelectReceipt,
}: {
  currentInvoice: CurrentInvoice | null;
  currentCustomerName: string;
  currentSaleCreatorId: string;
  currentSaleCreatorName: string;
  formatSaleCreator: (createdBy: string, createdByName?: string) => string;
  invoiceGrandTotal: number;
  /** What is still owed on the bill. */
  pendingAmount: number;
  /** The business's time zone, for the due date. */
  timeZone?: string;
  saleLines: SaleLine[];
  itemUomById: Map<string, string>;
  invoiceSubTotal: number;
  invoiceTaxTotal: number;
  paymentBreakdown: Array<{ mode: PaymentMode; amount: number }>;
  receiptsForInvoice: InvoiceReceipt[];
  /** The receipt picked to print; the bill's first when none is. */
  previewReceipt: InvoiceReceipt | null;
  onSelectReceipt: (receiptId: string) => void;
}) {
  return (
    <div className="card overflow-hidden print:hidden">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-b border-slate-200 p-5 text-sm 2xl:grid-cols-4">
        <div>
          <dt className="eyebrow">Customer</dt>
          <dd className="mt-1 truncate font-medium text-slate-900">{currentCustomerName}</dd>
          {currentInvoice?.buyerGstin ? (
            <dd className="mt-0.5 font-mono text-xs text-slate-600" title="Registered buyer: this bill goes in GSTR-1 B2B">
              GSTIN {currentInvoice.buyerGstin}
            </dd>
          ) : null}
          {currentInvoice?.reference ? <dd className="mt-0.5 text-xs text-slate-600">Ref {currentInvoice.reference}</dd> : null}
        </div>
        <div>
          <dt className="eyebrow">Sold by</dt>
          <dd className="mt-1 truncate font-medium text-slate-900">
            {currentSaleCreatorId
              ? formatSaleCreator(
                  currentSaleCreatorId,
                  currentSaleCreatorName,
                )
              : "—"}
          </dd>
        </div>
        <div>
          <dt className="eyebrow">Grand total</dt>
          <dd className="mt-1 font-semibold text-slate-900 tabular-nums">{inr(invoiceGrandTotal)}</dd>
        </div>
        <div>
          <dt className="eyebrow">Balance due</dt>
          <dd className={`mt-1 font-semibold tabular-nums ${pendingAmount > 0 ? "text-amber-700" : "text-slate-900"}`}>
            {inr(pendingAmount)}
          </dd>
          {currentInvoice?.dueDate && pendingAmount > 0 && currentInvoice.status !== "CANCELLED" ? (
            <dd
              className={`mt-0.5 text-xs ${isOverdue(currentInvoice, pendingAmount, timeZone) ? "font-semibold text-rose-700" : "text-slate-600"}`}
            >
              {isOverdue(currentInvoice, pendingAmount, timeZone) ? "Overdue: was due " : "Due by "}
              {formatReceiptDate(currentInvoice.dueDate, timeZone)}
            </dd>
          ) : null}
        </div>
        {currentInvoice?.status === "CANCELLED" && currentInvoice.cancelReason ? (
          <div className="col-span-full">
            <dt className="eyebrow">Cancelled</dt>
            <dd className="mt-1 text-slate-900">
              {currentInvoice.cancelReason}
              {currentInvoice.cancelledByName ? <span className="text-slate-500"> · by {currentInvoice.cancelledByName}</span> : null}
            </dd>
          </div>
        ) : null}
      </dl>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left">
            <th className="eyebrow px-5 py-2 font-semibold">Item</th>
            <th className="eyebrow px-5 py-2 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {saleLines.map((line) => (
            <tr key={line.id}>
              <td className="px-5 py-2.5 text-slate-700">
                <span className="font-medium text-slate-900">
                  {line.itemName ?? `Item ${line.itemId.slice(0, 6)}`}
                </span>
                <span className="ml-2 text-xs text-slate-500">
                  {getSaleQtyLabel(line, itemUomById)}
                  {line.saleUom ? ` (${formatQtyLabel(line.qty)} base)` : ""}
                </span>
                {line.batches ? <span className="block text-xs text-slate-500">{line.batches}</span> : null}
              </td>
              <td className="px-5 py-2.5 text-right text-slate-900 tabular-nums">{inr(line.netAmount)}</td>
            </tr>
          ))}
          {saleLines.length === 0 ? (
            <tr>
              <td colSpan={2} className="px-5 py-4 text-center text-xs text-slate-500">
                No line items available.
              </td>
            </tr>
          ) : null}
        </tbody>
        <tfoot className="border-t border-slate-200 text-slate-600">
          <tr>
            <td className="px-5 pt-3 text-right">Subtotal</td>
            <td className="px-5 pt-3 text-right tabular-nums">{inr(invoiceSubTotal)}</td>
          </tr>
          <tr>
            <td className="px-5 pt-1 text-right">Tax</td>
            <td className="px-5 pt-1 text-right tabular-nums">{inr(invoiceTaxTotal)}</td>
          </tr>
          <tr className="text-base font-semibold text-slate-900">
            <td className="px-5 pt-2 pb-4 text-right">Grand total</td>
            <td className="px-5 pt-2 pb-4 text-right tabular-nums">{inr(invoiceGrandTotal)}</td>
          </tr>
        </tfoot>
      </table>

      <div className="border-t border-slate-200 p-5">
        <p className="eyebrow">Payments</p>
        <div className="mt-2 divide-y divide-slate-100 text-sm">
          {paymentBreakdown.map((line, idx) => (
            <div
              key={`${line.mode}-${idx}`}
              className="flex items-center justify-between py-1.5"
            >
              <p className="text-slate-700">{line.mode}</p>
              <p className="font-medium text-slate-900 tabular-nums">{inr(line.amount)}</p>
            </div>
          ))}
          {paymentBreakdown.length === 0 ? (
            <p className="py-1.5 text-xs text-slate-500">
              No payments recorded yet.
            </p>
          ) : null}
        </div>
      </div>

      {receiptsForInvoice.length > 0 ? (
        <div className="border-t border-slate-200 p-5">
          <p className="eyebrow">Receipts</p>
          <div className="mt-2 grid gap-2 xl:grid-cols-2">
            {receiptsForInvoice.map((receipt) => {
              const isActive = previewReceipt?.id === receipt.id;
              return (
                <button
                  key={receipt.id}
                  className={`list-row text-xs ${isActive ? "is-active" : ""}`}
                  onClick={() => onSelectReceipt(receipt.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-slate-900">{receipt.receiptNo}</p>
                    <p className="font-semibold text-slate-900 tabular-nums">{inr(Number(receipt.amount))}</p>
                  </div>
                  <p className="mt-0.5 text-slate-500">{new Date(receipt.createdAt).toLocaleString()}</p>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
