import { useMutation, useQuery } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { formatReceiptDate } from "@pos/contracts";
import { api, apiErrorMessage, authHeaders } from "../../lib/api";
import { useIsOffline } from "../../lib/mode";
import { IconSend } from "../../components/icons";
import { OnlineOnlyBadge } from "../../components/OnlineOnly";
import { inr } from "../route-helpers";

/** YYYY-MM-DD in `timeZone`. */
function calendarDate(date: Date, timeZone?: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(date);
}

const KIND_LABEL = { BILL: "Bill", PAYMENT: "Payment", RETURN: "Return" } as const;

/**
 * A customer's statement of account over a period: bills, and the payments and returns taken
 * off what they owe, with the balance after each. Printable, and online it can be emailed.
 */
export function StatementPanel({
  customerId,
  branchId,
  defaultEmail,
  timeZone,
  storeName,
}: {
  customerId: string;
  branchId: string;
  defaultEmail: string | null;
  timeZone?: string;
  storeName: string;
}) {
  const offline = useIsOffline();
  const today = calendarDate(new Date(), timeZone);
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [email, setEmail] = useState(defaultEmail ?? "");
  const validPeriod = !!from && !!to && from <= to;

  const statement = useQuery({
    queryKey: ["customer-statement", customerId, branchId, from, to],
    enabled: validPeriod,
    queryFn: async () => {
      const res = await api.customers.statement({ params: { id: customerId }, query: { branchId, from, to }, extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "Couldn't load the statement"));
      return res.body;
    },
  });

  const send = useMutation({
    mutationFn: async (address: string) => {
      const res = await api.customers.emailStatement({
        params: { id: customerId },
        query: { branchId },
        body: { from, to, email: address },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 202) throw new Error(apiErrorMessage(res.body, "The statement couldn't be sent."));
      return address;
    },
  });

  const onSend = (event: FormEvent) => {
    event.preventDefault();
    send.mutate(email.trim());
  };

  const data = statement.data;
  const day = (iso: string) => formatReceiptDate(iso, data?.timezone ?? timeZone);
  const calendarDay = (date: string) => date.split("-").reverse().join("-");

  return (
    <div className="card overflow-hidden print:border-0 print:shadow-none">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 p-5 print:hidden">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Statement of account</h3>
          <p className="mt-0.5 text-xs text-slate-500">Bills, payments and returns, with what was owed after each.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="field-label" htmlFor="statement-from">From</label>
            <input id="statement-from" className="field" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="statement-to">To</label>
            <input id="statement-to" className="field" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </div>
          <button className="btn-secondary" type="button" onClick={() => window.print()} disabled={!data}>
            Print
          </button>
        </div>
      </div>

      {!validPeriod ? (
        <p className="p-5 text-sm text-rose-700">The start date must be on or before the end date.</p>
      ) : statement.isLoading ? (
        <p className="p-5 text-sm text-slate-500">Loading…</p>
      ) : statement.error ? (
        <p className="p-5 text-sm text-rose-700">{(statement.error as Error).message}</p>
      ) : data ? (
        <div className="p-5">
          <div className="hidden print:block">
            <p className="text-lg font-semibold">{storeName}</p>
            <p className="text-sm">Statement of account</p>
            <p className="mt-2 text-sm font-medium">
              {data.customer.name} ({data.customer.code})
            </p>
            {data.customer.gstin ? <p className="text-sm">GSTIN {data.customer.gstin}</p> : null}
            {data.customer.address ? <p className="text-sm whitespace-pre-line">{data.customer.address}</p> : null}
            <p className="mt-2 mb-3 text-sm">
              {calendarDay(data.from)} to {calendarDay(data.to)}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">Particulars</th>
                  <th className="py-2 pr-3 font-medium">Ref</th>
                  <th className="py-2 pr-3 text-right font-medium">Debit</th>
                  <th className="py-2 pr-3 text-right font-medium">Credit</th>
                  <th className="py-2 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                <tr className="border-b border-slate-100 text-slate-600">
                  <td className="py-2 pr-3 whitespace-nowrap">{calendarDay(data.from)}</td>
                  <td className="py-2 pr-3" colSpan={4}>Opening balance</td>
                  <td className="py-2 text-right font-medium">{inr(data.openingBalance)}</td>
                </tr>
                {data.entries.map((entry, index) => (
                  <tr key={`${entry.reference}-${index}`} className="border-b border-slate-100">
                    <td className="py-2 pr-3 whitespace-nowrap">{day(entry.date)}</td>
                    <td className="py-2 pr-3">
                      {KIND_LABEL[entry.kind]}
                      {entry.detail ? <span className="text-slate-500">: {entry.detail}</span> : null}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">{entry.reference}</td>
                    <td className="py-2 pr-3 text-right">{entry.debit ? inr(entry.debit) : ""}</td>
                    <td className="py-2 pr-3 text-right text-emerald-700">{entry.credit ? inr(entry.credit) : ""}</td>
                    <td className="py-2 text-right">{inr(entry.balance)}</td>
                  </tr>
                ))}
                <tr className="font-semibold text-slate-900">
                  <td className="py-2 pr-3 whitespace-nowrap">{calendarDay(data.to)}</td>
                  <td className="py-2 pr-3" colSpan={2}>Closing balance</td>
                  <td className="py-2 pr-3 text-right">{inr(data.totals.debit)}</td>
                  <td className="py-2 pr-3 text-right">{inr(data.totals.credit)}</td>
                  <td className="py-2 text-right">{inr(data.closingBalance)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {data.entries.length === 0 ? <p className="mt-2 text-xs text-slate-500">Nothing in this period.</p> : null}

          <dl className="mt-4 grid grid-cols-2 gap-3 rounded-md bg-slate-50 p-3 text-xs sm:grid-cols-6 print:bg-white">
            {(
              [
                ["0–30 days", data.ageing.days0to30],
                ["31–60 days", data.ageing.days31to60],
                ["61–90 days", data.ageing.days61to90],
                ["Over 90 days", data.ageing.over90],
                ["Owed now", data.ageing.total],
                ["Overdue", data.overdue],
              ] as const
            ).map(([label, amount]) => (
              <div key={label}>
                <dt className="text-slate-500">{label}</dt>
                <dd className={`mt-0.5 font-semibold tabular-nums ${label === "Overdue" && amount > 0 ? "text-rose-700" : "text-slate-900"}`}>{inr(amount)}</dd>
              </div>
            ))}
          </dl>

          <form onSubmit={onSend} className="mt-4 max-w-md print:hidden">
            <label className="field-label flex items-center gap-2" htmlFor={`email-statement-${customerId}`}>
              Email this statement
              {offline ? <OnlineOnlyBadge /> : null}
            </label>
            <div className="flex gap-2">
              <input
                id={`email-statement-${customerId}`}
                className="field"
                type="email"
                placeholder="customer@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={offline || send.isPending}
                required
              />
              <button className="btn-secondary shrink-0" type="submit" disabled={offline || send.isPending}>
                <IconSend width={16} height={16} />
                {send.isPending ? "Sending…" : "Send"}
              </button>
            </div>
            {offline ? (
              <p className="mt-1 text-xs text-slate-500">Emailing needs the business online.</p>
            ) : send.isSuccess ? (
              <p className="mt-1 text-xs text-emerald-700" role="status">Sent to {send.data}.</p>
            ) : send.error ? (
              <p className="mt-1 text-xs text-rose-700" role="alert">{(send.error as Error).message}</p>
            ) : null}
          </form>
        </div>
      ) : null}
    </div>
  );
}
