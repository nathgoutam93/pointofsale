import { invoiceDue, type splitReturn } from "@pos/contracts";
import { inr } from "../route-helpers";
import { formatQty } from "./returnQty";
import type { ReturnLine, ReturnRefundMode } from "./types";
import type { ReturnableInvoice } from "./useBillSearch";

/**
 * Making a return: find the bill, enter what comes back line by line, how it is refunded and
 * why. What the bill still owes is taken off first; only the rest is refunded.
 */
export function NewReturnForm({
  onCancel,
  invoiceSearch,
  setInvoiceSearch,
  filteredInvoices,
  selectedInvoiceId,
  onSelectInvoice,
  customerById,
  refundMode,
  setRefundMode,
  totalReturnAmount,
  returnSplit,
  walletAllowed,
  selectedInvoice,
  selectedCustomer,
  selectedDue,
  returnLines,
  lineQtyMap,
  onLineQtyChange,
  reason,
  setReason,
  createReturn,
  message,
}: {
  onCancel: () => void;
  invoiceSearch: string;
  setInvoiceSearch: (search: string) => void;
  /** The bills matching the search (not cancelled ones). */
  filteredInvoices: ReturnableInvoice[];
  selectedInvoiceId: string;
  onSelectInvoice: (invoice: ReturnableInvoice) => void;
  customerById: Map<string, { name: string; isWalkIn: boolean }>;
  refundMode: ReturnRefundMode;
  setRefundMode: (mode: ReturnRefundMode) => void;
  totalReturnAmount: number;
  /** How the return splits between what is still owed and what is refunded. */
  returnSplit: ReturnType<typeof splitReturn>;
  /** Wallet credit only for registered customers. */
  walletAllowed: boolean;
  selectedInvoice: ReturnableInvoice | null;
  selectedCustomer: { name: string; isWalkIn: boolean } | undefined;
  /** What is still owed on the selected bill. */
  selectedDue: number;
  returnLines: ReturnLine[];
  /** The return quantity typed for each line, by line id. */
  lineQtyMap: Record<string, string>;
  onLineQtyChange: (lineId: string, value: string) => void;
  reason: string;
  setReason: (reason: string) => void;
  createReturn: { isPending: boolean; isError: boolean; mutate: () => void };
  message: string;
}) {
  return (
    <div className="card mx-auto max-w-5xl p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="page-title">New Return</h3>
        <button
          type="button"
          className="btn-ghost"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="field-label">
            Search Invoice
          </label>
          <input
            className="field"
            placeholder="Type invoice no or customer name"
            value={invoiceSearch}
            onChange={(e) => setInvoiceSearch(e.target.value)}
          />
          {invoiceSearch.trim() ? (
            <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-md border border-slate-200 bg-white p-1 shadow-sm">
              {filteredInvoices.map((invoice) => (
                <button
                  key={invoice.id}
                  type="button"
                  className={`w-full rounded-md px-3 py-2 text-left text-sm ${selectedInvoiceId === invoice.id ? "bg-brand-50 text-brand-800 ring-1 ring-brand-500" : "text-slate-700 hover:bg-slate-50"}`}
                  onClick={() => onSelectInvoice(invoice)}
                >
                  <p className="font-semibold">{invoice.invoiceNo}</p>
                  <p className="text-xs text-slate-500">
                    {customerById.get(invoice.customerId)?.name ?? "Unknown"} · {inr(invoice.grandTotal)}
                    {invoiceDue(invoice) > 0 ? <span className="text-amber-700"> · Due {inr(invoiceDue(invoice))}</span> : null}
                  </p>
                </button>
              ))}
              {filteredInvoices.length === 0 ? (
                <p className="px-2 py-2 text-xs text-slate-500">No matching invoice found.</p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div>
          <label className="field-label">
            Refund Mode
          </label>
          <select
            className="field"
            value={refundMode}
            disabled={totalReturnAmount > 0 && returnSplit.refundAmount === 0}
            onChange={(e) => setRefundMode(e.target.value as ReturnRefundMode)}
          >
            <option value="CASH">Cash Refund</option>
            {walletAllowed ? <option value="WALLET">Wallet Credit</option> : null}
          </select>
          {totalReturnAmount > 0 && returnSplit.refundAmount === 0 ? (
            <p className="mt-1 text-xs text-slate-500">Nothing to refund: it all comes off what the customer owes.</p>
          ) : null}
          {!walletAllowed ? (
            <p className="mt-1 text-xs text-amber-700">
              Wallet credit is available only for registered customers.
            </p>
          ) : null}
        </div>
      </div>

      {selectedInvoice ? (
        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          <p>
            <span className="font-semibold">Invoice:</span> {selectedInvoice.invoiceNo}
          </p>
          <p>
            <span className="font-semibold">Customer:</span> {selectedCustomer?.name ?? "Unknown"}
          </p>
          {selectedDue > 0 ? (
            <p className="mt-1 text-amber-800">
              <span className="font-semibold">Still owed:</span> {inr(selectedDue)} of {inr(selectedInvoice.grandTotal)}. A
              return comes off this first; only the rest is refunded.
            </p>
          ) : null}
        </div>
      ) : null}

      {returnLines.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-2 py-2">Item</th>
                <th className="px-2 py-2">Sold</th>
                <th className="px-2 py-2">Already Returned</th>
                <th className="px-2 py-2">Available</th>
                <th className="px-2 py-2">Return Qty</th>
                <th className="px-2 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {returnLines.map((line) => (
                <tr key={line.lineId}>
                  <td className="px-2 py-2 text-slate-800">{line.itemName}</td>
                  <td className="px-2 py-2">{formatQty(line.soldQty, line.leastCount)}</td>
                  <td className="px-2 py-2">{formatQty(line.alreadyReturned, line.leastCount)}</td>
                  <td className="px-2 py-2 font-semibold">{formatQty(line.availableQty, line.leastCount)}</td>
                  <td className="px-2 py-2">
                    <input
                      className="field w-28"
                      type="number"
                      min={0}
                      max={line.availableQty}
                      step={line.leastCountStep}
                      value={lineQtyMap[line.lineId] ?? ""}
                      onChange={(e) => onLineQtyChange(line.lineId, e.target.value)}
                    />
                  </td>
                  <td className="px-2 py-2 text-right font-medium">{inr(line.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {returnSplit.dueAdjusted > 0 ? (
                <>
                  <tr className="border-t border-slate-200">
                    <td colSpan={5} className="px-2 py-2 text-right text-slate-600">
                      Returned
                    </td>
                    <td className="px-2 py-2 text-right font-medium text-slate-900">{inr(totalReturnAmount)}</td>
                  </tr>
                  <tr>
                    <td colSpan={5} className="px-2 py-2 text-right text-slate-600">
                      Taken off amount due
                    </td>
                    <td className="px-2 py-2 text-right font-medium text-slate-900">{inr(returnSplit.dueAdjusted)}</td>
                  </tr>
                </>
              ) : null}
              <tr className="border-t border-slate-200">
                <td colSpan={5} className="px-2 py-3 text-right font-semibold text-slate-700">
                  Total Refund
                </td>
                <td className="px-2 py-3 text-right text-base font-bold text-slate-900">
                  {inr(returnSplit.refundAmount)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : null}

      <label className="mt-4 block max-w-md">
        <span className="field-label">Reason</span>
        <input
          className="field"
          maxLength={200}
          placeholder="Why the goods came back (damaged, wrong size...)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>

      <button
        className="btn-primary mt-4"
        disabled={createReturn.isPending || !selectedInvoiceId || returnLines.length === 0 || reason.trim().length < 3}
        onClick={() => createReturn.mutate()}
      >
        {createReturn.isPending ? "Processing Return..." : "Create Return"}
      </button>

      {message ? (
        <p
          className={`mt-3 rounded-md border px-3 py-2 text-sm ${createReturn.isError ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
