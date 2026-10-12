import { useQuery } from "@tanstack/react-query";
import { api, authHeaders } from "../../lib/api";
import { inr } from "../route-helpers";

const KIND_LABELS = { PURCHASE: "Purchase", RETURN: "Sent back", PAYMENT: "Payment" } as const;

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "2-digit" });
}

/** What is owed to a supplier: the bills not yet paid (oldest paid first) and every entry with the running balance. */
export function SupplierAccount({ supplierId }: { supplierId: string }) {
  const account = useQuery({
    queryKey: ["supplier-account", supplierId],
    queryFn: async () => {
      const res = await api.suppliers.account({ params: { id: supplierId }, extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error("Failed to load the account");
      return res.body;
    },
  });
  if (account.isLoading) return <p className="text-sm text-slate-500">Loading account...</p>;
  if (!account.data) return <p className="text-sm text-rose-700">Couldn't load the account.</p>;
  const { supplier, openBills, entries } = account.data;

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="rounded-md border border-slate-200 p-3">
          <dt className="eyebrow">{supplier.balance < 0 ? "They owe us" : "We owe"}</dt>
          <dd className="text-lg font-semibold tabular-nums text-slate-900">{inr(Math.abs(supplier.balance))}</dd>
        </div>
        <div className="rounded-md border border-slate-200 p-3">
          <dt className="eyebrow">Overdue</dt>
          <dd className={`text-lg font-semibold tabular-nums ${supplier.overdue > 0 ? "text-rose-700" : "text-slate-900"}`}>{inr(supplier.overdue)}</dd>
        </div>
        <div className="rounded-md border border-slate-200 p-3">
          <dt className="eyebrow">Payment terms</dt>
          <dd className="text-lg font-semibold text-slate-900">{supplier.paymentTermsDays === null ? "Due at once" : `${supplier.paymentTermsDays} days`}</dd>
        </div>
      </dl>

      <div>
        <h4 className="mb-2 text-sm font-semibold text-slate-900">Bills not yet paid</h4>
        {openBills.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing is owed on any bill.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="eyebrow border-b border-slate-200 text-left">
                <th className="py-2">Purchase</th>
                <th className="py-2">Bill date</th>
                <th className="py-2">Due</th>
                <th className="py-2 text-right">Bill</th>
                <th className="py-2 text-right">Still owed</th>
              </tr>
            </thead>
            <tbody>
              {openBills.map((bill) => (
                <tr key={bill.purchaseId} className="border-b border-slate-100">
                  <td className="py-2 pr-3">
                    {bill.purchaseNo}
                    {bill.supplierInvoiceNo ? <span className="text-xs text-slate-500"> · bill {bill.supplierInvoiceNo}</span> : null}
                  </td>
                  <td className="py-2 pr-3">{bill.date}</td>
                  <td className={`py-2 pr-3 ${bill.overdue ? "font-semibold text-rose-700" : ""}`}>
                    {bill.dueDate ?? "-"}
                    {bill.overdue ? " (overdue)" : ""}
                  </td>
                  <td className="py-2 text-right tabular-nums">{inr(bill.total)}</td>
                  <td className="py-2 text-right font-semibold tabular-nums">{inr(bill.outstanding)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <h4 className="mb-2 text-sm font-semibold text-slate-900">Account</h4>
        {entries.length === 0 ? (
          <p className="text-sm text-slate-500">No purchases, returns or payments yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="eyebrow border-b border-slate-200 text-left">
                <th className="py-2">Date</th>
                <th className="py-2">Entry</th>
                <th className="py-2 text-right">Amount</th>
                <th className="py-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {[...entries].reverse().map((entry) => (
                <tr key={`${entry.kind}-${entry.id}`} className="border-b border-slate-100">
                  <td className="py-2 pr-3">{formatDate(entry.date)}</td>
                  <td className="py-2 pr-3">
                    {KIND_LABELS[entry.kind]} <span className="text-xs text-slate-500">{entry.reference}</span>
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {entry.kind === "PURCHASE" ? "+ " : "− "}
                    {inr(entry.amount)}
                  </td>
                  <td className="py-2 text-right tabular-nums">{inr(entry.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
