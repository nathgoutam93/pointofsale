import { useQuery } from "@tanstack/react-query";
import { api, authHeaders } from "../lib/api";
import { money, requireSession } from "./route-helpers";

function formatShortDate(value: string) {
  return new Date(value).toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

export function ReportsPage() {
  const session = requireSession();

  const summary = useQuery({
    queryKey: ["reports-sales-summary", session.branchId],
    enabled: session.role === "ADMIN",
    queryFn: async () => {
      const res = await api.reports.salesSummary({
        query: { branchId: session.branchId },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error("Failed to load report");
      return res.body;
    },
  });

  if (session.role !== "ADMIN") {
    return (
      <section className="p-6">
        <div className="mx-auto max-w-4xl rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
          <h2 className="text-lg font-semibold">Admin access required</h2>
          <p className="mt-2 text-sm">
            Sales analytics are available only to admin users.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="p-6">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
              Sales Report
            </p>
            <h2 className="text-2xl font-semibold text-slate-900">
              Sales, Expenses, and Profit
            </h2>
          </div>
          <p className="text-xs text-slate-500">
            Generated{
              summary.data?.generatedAt
                ? ` ${formatShortDate(summary.data.generatedAt)}`
                : ""
            }
          </p>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {(summary.data?.ranges ?? []).map((range) => {
            let dateLabel = "All time";
            if (range.startDate && range.endDate) {
              const endInclusive = new Date(range.endDate);
              endInclusive.setDate(endInclusive.getDate() - 1);
              dateLabel = `${formatShortDate(range.startDate)} - ${formatShortDate(endInclusive.toISOString())}`;
            }
            return (
              <div
                key={range.label}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-800">
                    {range.label}
                  </h3>
                  <span className="text-xs text-slate-400">{dateLabel}</span>
                </div>
                <div className="mt-4 space-y-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Sales</span>
                    <span className="font-semibold">{money(range.salesTotal)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Returns</span>
                    <span className="font-semibold">{money(range.returnsTotal)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Net Sales</span>
                    <span className="font-semibold">{money(range.netSales)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Expenses (Stock In)</span>
                    <span className="font-semibold">{money(range.expensesTotal)}</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                    <span className="text-slate-700">Profit</span>
                    <span className="text-base font-semibold text-emerald-600">
                      {money(range.profit)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {summary.isLoading ? (
          <p className="mt-6 text-sm text-slate-500">Loading report…</p>
        ) : summary.error ? (
          <p className="mt-6 text-sm text-red-600">
            Failed to load report. Please try again.
          </p>
        ) : null}
      </div>
    </section>
  );
}
