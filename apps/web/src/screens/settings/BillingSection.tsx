import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BillingPeriod, BillingSummary, PlanCode } from "@pos/contracts";
import { useEffect, useRef, useState } from "react";
import { api, apiErrorMessage, authHeaders } from "../../lib/api";
import { longDate, openPayment, rupees } from "../../lib/billing";

const PERIOD_LABELS: Record<BillingPeriod, string> = { month: "month", year: "year" };

/** How long the screen keeps checking for a payment made in the browser. */
const WAIT_FOR_PAYMENT_MS = 10 * 60 * 1000;

function standing(summary: BillingSummary, planName: string) {
  if (!summary.enforced) return "Payments aren't set up on this server, so nothing is charged and nothing is limited.";
  switch (summary.state) {
    case "trial":
      return `Free trial of the ${planName} plan until ${longDate(summary.endsAt)}.`;
    case "active":
      return `${planName} plan, paid until ${longDate(summary.endsAt)}.`;
    case "past_due":
      return `The subscription ended on ${longDate(summary.endsAt)}. Pay by ${longDate(summary.graceEndsAt)} to keep selling.`;
    case "read_only":
      return `The subscription ended on ${longDate(summary.endsAt)}. The business is read-only until it is paid.`;
  }
}

/** Settings → Billing (managed hosting, admins): the plan, paying for it, and invoices. */
export function BillingSection() {
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<BillingPeriod>("month");
  // A payment opened in the browser: the paid-until date it started from, to notice it arrive.
  const [waitingFrom, setWaitingFrom] = useState<{ paidUntil: string | null } | null>(null);
  const [invoice, setInvoice] = useState<{ number: string; html: string } | null>(null);

  const summary = useQuery({
    queryKey: ["billing"],
    queryFn: async () => {
      const res = await api.billing.summary({ extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "Couldn't load the subscription"));
      return res.body;
    },
    refetchOnWindowFocus: true,
    refetchInterval: waitingFrom ? 5000 : false,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["billing"] });
    void queryClient.invalidateQueries({ queryKey: ["billing-status"] });
  };

  useEffect(() => {
    if (!waitingFrom) return;
    if (summary.data && summary.data.paidUntil !== waitingFrom.paidUntil) {
      setWaitingFrom(null);
      refresh();
      return;
    }
    const stop = window.setTimeout(() => setWaitingFrom(null), WAIT_FOR_PAYMENT_MS);
    return () => window.clearTimeout(stop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingFrom, summary.data?.paidUntil]);

  const pay = useMutation({
    mutationFn: async (plan: PlanCode) => {
      const res = await api.billing.checkout({ body: { plan, period }, extraHeaders: authHeaders() });
      if (res.status !== 201) throw new Error(apiErrorMessage(res.body, "The payment couldn't be started"));
      await openPayment(res.body.payPath);
    },
    onSuccess: () => setWaitingFrom({ paidUntil: summary.data?.paidUntil ?? null }),
  });

  const showInvoice = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.billing.invoice({ params: { id }, extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "Couldn't open the invoice"));
      return res.body;
    },
    onSuccess: setInvoice,
  });

  if (summary.isLoading) return <div className="card p-5 text-sm text-slate-600">Loading…</div>;
  if (!summary.data) return <div className="card p-5 text-sm text-rose-700">{summary.error?.message ?? "Couldn't load the subscription"}</div>;
  const data = summary.data;
  const current = data.plans.find((plan) => plan.code === data.plan) ?? data.plans[0];

  return (
    <div className="grid gap-4">
      <div className="card p-5">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">Subscription</h2>
        <p className="mt-1 text-sm text-slate-600">{standing(data, current.name)}</p>
        <p className="mt-1 text-sm text-slate-600">
          Using {data.usage.branches} of {current.branches} branch{current.branches === 1 ? "" : "es"} and {data.usage.counters} of{" "}
          {current.counters} counter{current.counters === 1 ? "" : "s"}.
        </p>
        {data.gatewayNote ? <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{data.gatewayNote}</p> : null}
      </div>

      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">Plans</h2>
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5" role="radiogroup" aria-label="Pay for">
            {(["month", "year"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={period === value}
                className={`rounded-md px-3 py-1 text-sm font-semibold ${period === value ? "bg-brand-600 text-white" : "text-slate-600"}`}
                onClick={() => setPeriod(value)}
              >
                {value === "month" ? "Monthly" : "Yearly"}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {data.plans.map((plan) => {
            const price = plan.prices[period];
            const isCurrent = plan.code === data.plan;
            return (
              <div key={plan.code} className={`rounded-xl border p-4 ${isCurrent ? "border-brand-500 ring-1 ring-brand-500" : "border-slate-200"}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-semibold text-slate-900">{plan.name}</h3>
                  {isCurrent ? <span className="text-xs font-semibold text-brand-700">Current</span> : null}
                </div>
                <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">
                  {rupees(price.total)}
                  <span className="text-sm font-normal text-slate-500"> / {PERIOD_LABELS[period]}</span>
                </p>
                <p className="text-xs text-slate-500">{data.gstRate ? `Includes ${data.gstRate}% GST (${rupees(price.gst)})` : "No GST charged"}</p>
                <p className="mt-2 text-sm text-slate-600">
                  Up to {plan.branches} branch{plan.branches === 1 ? "" : "es"} and {plan.counters} counters
                </p>
                <button
                  type="button"
                  className={`${isCurrent ? "btn-primary" : "btn-secondary"} mt-3 w-full`}
                  disabled={!data.paymentsEnabled || pay.isPending}
                  onClick={() => pay.mutate(plan.code)}
                >
                  {isCurrent ? `Pay for a ${PERIOD_LABELS[period]}` : `Switch and pay`}
                </button>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Paying for the current plan adds to the time already paid, after any trial. A different plan starts at once; time already paid
          carries over, worth the same at the new plan's price. Branches and counters over a smaller plan's limits keep working; only
          adding more is stopped.
        </p>
        {pay.error ? <p className="mt-2 text-sm text-rose-700">{pay.error.message}</p> : null}
        {waitingFrom ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900" role="status">
            <span>Finish paying in the browser window that opened. This page updates when the payment arrives.</span>
            <button type="button" className="btn-ghost" onClick={() => setWaitingFrom(null)}>
              Stop waiting
            </button>
          </div>
        ) : null}
      </div>

      <div className="card p-5">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">Invoices</h2>
        {data.invoices.length === 0 ? (
          <p className="mt-1 text-sm text-slate-600">No payments yet.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs text-slate-500 uppercase">
              <tr>
                <th className="py-2">Number</th>
                <th className="py-2">Date</th>
                <th className="py-2">For</th>
                <th className="py-2 text-right">Paid</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {data.invoices.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="py-2 font-mono">{row.number}</td>
                  <td className="py-2">{longDate(row.issuedAt)}</td>
                  <td className="py-2">
                    {data.plans.find((plan) => plan.code === row.plan)?.name ?? row.plan}, 1 {PERIOD_LABELS[row.period]}
                  </td>
                  <td className="py-2 text-right tabular-nums">{rupees(row.total)}</td>
                  <td className="py-2 text-right">
                    <button type="button" className="btn-ghost" disabled={showInvoice.isPending} onClick={() => showInvoice.mutate(row.id)}>
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {showInvoice.error ? <p className="mt-2 text-sm text-rose-700">{showInvoice.error.message}</p> : null}
      </div>

      {invoice ? <InvoiceDialog invoice={invoice} onClose={() => setInvoice(null)} /> : null}
    </div>
  );
}

/** An invoice page in a sandboxed frame (no scripts), with its own print. */
function InvoiceDialog({ invoice, onClose }: { invoice: { number: string; html: string }; onClose: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  return (
    <div className="modal-backdrop z-50">
      <div className="flex h-[85vh] w-full max-w-3xl flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">Invoice {invoice.number}</h2>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={() => frame.current?.contentWindow?.print()}>
              Print
            </button>
            <button type="button" className="btn-primary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <iframe
          ref={frame}
          title={`Invoice ${invoice.number}`}
          className="mt-3 min-h-0 flex-1 rounded-lg border border-slate-200"
          sandbox="allow-same-origin allow-modals"
          srcDoc={invoice.html}
        />
      </div>
    </div>
  );
}
