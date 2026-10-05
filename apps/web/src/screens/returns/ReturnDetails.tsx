import { ReceiptView } from "../../components/ReceiptView";
import { IconPrinter } from "../../components/icons";
import type { RenderedReceipt } from "../../lib/receipt";
import { inr } from "../route-helpers";
import type { Returns } from "./useReturns";

/** The return selected in the list: what came back, how it was refunded, and its receipt. */
export function ReturnDetails({
  returnDetail,
  selectedReturnId,
  printing,
  printError,
  onPrint,
  printableReturn,
  receiptLogoSrc,
  message,
}: {
  returnDetail: Returns["returnDetail"];
  selectedReturnId: string;
  printing: boolean;
  printError: string;
  onPrint: () => void;
  printableReturn: RenderedReceipt | null;
  receiptLogoSrc: string | null | undefined;
  message: string;
}) {
  return (
    <div className="card mx-auto max-w-5xl p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="page-title">{returnDetail.data?.returnNo ?? "Return Details"}</h3>
        {returnDetail.data ? (
          <button
            type="button"
            className="btn-secondary print:hidden"
            disabled={printing}
            onClick={onPrint}
          >
            <IconPrinter width={16} height={16} />
            {printing ? "Printing…" : "Print Receipt"}
          </button>
        ) : null}
      </div>
      {printError ? (
        <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 print:hidden" role="alert">
          {printError}
        </p>
      ) : null}
      {!selectedReturnId ? (
        <p className="mt-3 text-sm text-slate-500">Select a return from the left list.</p>
      ) : null}
      {returnDetail.isLoading ? (
        <p className="mt-3 text-sm text-slate-500">Loading return details...</p>
      ) : null}
      {returnDetail.data ? (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm md:grid-cols-4">
            <div>
              <dt className="eyebrow">Invoice</dt>
              <dd className="mt-1 font-medium text-slate-900">{returnDetail.data.saleInvoiceNo}</dd>
            </div>
            <div>
              <dt className="eyebrow">Customer</dt>
              <dd className="mt-1 font-medium text-slate-900">{returnDetail.data.customerName}</dd>
            </div>
            <div>
              <dt className="eyebrow">Refund mode</dt>
              <dd className="mt-1 font-medium text-slate-900">
                {Number(returnDetail.data.refundAmount) > 0 ? returnDetail.data.refundMode : "None"}
              </dd>
            </div>
            <div>
              <dt className="eyebrow">Total refund</dt>
              <dd className="mt-1 font-semibold text-slate-900 tabular-nums">{inr(returnDetail.data.refundAmount)}</dd>
              {Number(returnDetail.data.dueAdjusted) > 0 ? (
                <dd className="mt-0.5 text-xs text-slate-500">
                  {inr(returnDetail.data.dueAdjusted)} of {inr(returnDetail.data.totalAmount)} taken off the amount due
                </dd>
              ) : null}
            </div>
            {returnDetail.data.reason || returnDetail.data.createdByName ? (
              <div className="col-span-2 md:col-span-4">
                <dt className="eyebrow">Reason</dt>
                <dd className="mt-1 text-slate-900">
                  {returnDetail.data.reason ?? "Not recorded"}
                  {returnDetail.data.createdByName ? (
                    <span className="text-slate-500"> · by {returnDetail.data.createdByName}</span>
                  ) : null}
                </dd>
              </div>
            ) : null}
          </dl>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-2 py-2">Item</th>
                  <th className="px-2 py-2">Qty</th>
                  <th className="px-2 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {returnDetail.data.lines.map((line) => (
                  <tr key={line.id}>
                    <td className="px-2 py-2">{line.itemName}</td>
                    <td className="px-2 py-2">{Number(line.qty).toFixed(3)}</td>
                    <td className="px-2 py-2 text-right">{inr(line.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500 print:hidden">
              Printable Return Receipt
            </p>
            <ReceiptView
              receipt={printableReturn}
              logoSrc={receiptLogoSrc}
              className="mx-auto w-fit border border-slate-200 bg-white p-4 shadow-xs"
            />
          </div>
        </>
      ) : null}
      {message ? <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p> : null}
    </div>
  );
}
