import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, authHeaders } from "../lib/api";
import { inr, requireAdmin } from "./route-helpers";

const ALL_BRANCHES_OPTION = "__all_branches__";

// Report figures that add up across branches for "All branches".
const SUMMED_FIELDS = [
  "invoiceCount",
  "grossSales",
  "taxCollected",
  "returnsGross",
  "returnsNet",
  "netSales",
  "costOfGoodsSold",
  "grossProfit",
  "unpaidSales",
] as const;

// Report periods are in the business time zone; show their dates in it too, whatever
// time zone this browser is in.
function formatShortDate(value: string | number, timeZone?: string) {
  return new Date(value).toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    timeZone,
  });
}

export function ReportsPage() {
  const session = requireAdmin();
  const initialBranchId = useMemo(
    () => session.branchId ?? session.branches[0]?.id ?? "",
    [session.branchId, session.branches]
  );
  const [selectedBranchId, setSelectedBranchId] = useState(initialBranchId);
  const isAllBranchesSelected = selectedBranchId === ALL_BRANCHES_OPTION;
  const selectedBranch = session.branches.find((branch) => branch.id === selectedBranchId);

  const singleBranchSummary = useQuery({
    queryKey: ["reports-sales-summary", selectedBranchId],
    enabled: session.role === "ADMIN" && !isAllBranchesSelected && !!selectedBranchId,
    queryFn: async () => {
      const res = await api.reports.salesSummary({
        query: { branchId: selectedBranchId },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error("Failed to load report");
      return res.body;
    },
  });
  const allBranchSummaries = useQueries({
    queries: session.branches.map((branch) => ({
      queryKey: ["reports-sales-summary", branch.id],
      enabled: session.role === "ADMIN" && isAllBranchesSelected,
      queryFn: async () => {
        const res = await api.reports.salesSummary({
          query: { branchId: branch.id },
          extraHeaders: authHeaders(),
        });
        if (res.status !== 200) throw new Error("Failed to load report");
        return res.body;
      },
    })),
  });

  const allBranchesSummary = useMemo(() => {
    if (!isAllBranchesSelected || allBranchSummaries.length === 0) return null;
    if (allBranchSummaries.some((query) => !query.data)) return null;

    const datasets = allBranchSummaries.map((query) => query.data!);
    const first = datasets[0];
    const generatedAt = datasets.reduce(
      (latest, current) =>
        Date.parse(current.generatedAt) > Date.parse(latest) ? current.generatedAt : latest,
      first.generatedAt
    );

    const ranges = first.ranges.map((range, index) => {
      const sum = (key: (typeof SUMMED_FIELDS)[number]) =>
        datasets.reduce((acc, data) => acc + Number(data.ranges[index]?.[key] ?? 0), 0);
      const collected = (mode: "cash" | "card" | "upi" | "wallet") =>
        datasets.reduce((acc, data) => acc + Number(data.ranges[index]?.collections?.[mode] ?? 0), 0);
      return {
        ...range,
        ...Object.fromEntries(SUMMED_FIELDS.map((key) => [key, sum(key)])),
        collections: { cash: collected("cash"), card: collected("card"), upi: collected("upi"), wallet: collected("wallet") },
      } as typeof range;
    });

    return {
      branchId: ALL_BRANCHES_OPTION,
      generatedAt,
      timezone: first.timezone,
      ranges,
    };
  }, [allBranchSummaries, isAllBranchesSelected]);

  const summary = isAllBranchesSelected ? allBranchesSummary : singleBranchSummary.data;
  const isLoading = isAllBranchesSelected
    ? allBranchSummaries.some((query) => query.isLoading)
    : singleBranchSummary.isLoading;
  const hasError = isAllBranchesSelected
    ? allBranchSummaries.some((query) => query.error)
    : Boolean(singleBranchSummary.error);

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

  if (!session.branches.length) {
    return (
      <section className="p-6">
        <p className="text-sm text-slate-600">No branch access is configured for this admin account.</p>
      </section>
    );
  }

  const ranges = (summary?.ranges ?? []).map((range) => {
    let dateLabel = "All time";
    if (range.startDate && range.endDate) {
      // The end is exclusive: the period's last day is the one just before it.
      const lastMoment = Date.parse(range.endDate) - 1;
      const first = formatShortDate(range.startDate, summary?.timezone);
      const last = formatShortDate(lastMoment, summary?.timezone);
      dateLabel = first === last ? first : `${first} – ${last}`;
    }
    const margin = range.netSales > 0 ? (range.grossProfit / range.netSales) * 100 : null;
    return { ...range, dateLabel, margin };
  });

  const rows: Array<{ label: string; value: (r: (typeof ranges)[number]) => number; emphasis?: boolean }> = [
    { label: "Sales incl. tax", value: (r) => r.grossSales },
    { label: "Tax collected", value: (r) => r.taxCollected },
    { label: "Returns before tax", value: (r) => r.returnsNet },
    { label: "Net sales (excl. tax)", value: (r) => r.netSales, emphasis: true },
    { label: "Cost of goods sold", value: (r) => r.costOfGoodsSold },
    { label: "Gross profit", value: (r) => r.grossProfit, emphasis: true },
  ];
  const hasUnpaid = ranges.some((r) => r.unpaidSales > 0);
  // Money taken in each period, by how it was paid (whenever its bill was made).
  const collectionRows: Array<{ label: string; value: (r: (typeof ranges)[number]) => number }> = [
    { label: "Cash", value: (r) => r.collections?.cash ?? 0 },
    { label: "Card", value: (r) => r.collections?.card ?? 0 },
    { label: "UPI", value: (r) => r.collections?.upi ?? 0 },
    { label: "Customer wallet", value: (r) => r.collections?.wallet ?? 0 },
  ];

  return (
    <section className="p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">
              Sales, cost and gross profit
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {isAllBranchesSelected
                ? "All branches"
                : selectedBranch
                  ? selectedBranch.name
                  : "Selected branch"}
              {summary?.generatedAt ? ` · Generated ${formatShortDate(summary.generatedAt, summary.timezone)}` : ""}
              {summary?.timezone ? ` · ${summary.timezone} time` : ""}
            </p>
          </div>
          <div className="w-64">
            <label className="field-label" htmlFor="report-branch">Branch</label>
            <select
              id="report-branch"
              className="field"
              value={selectedBranchId}
              onChange={(event) => setSelectedBranchId(event.target.value)}
            >
              <option value={ALL_BRANCHES_OPTION}>All branches</option>
              {session.branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-slate-500">Loading report…</p>
        ) : hasError ? (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
            Failed to load report. Please try again.
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {ranges.map((range) => (
            <div key={range.label} className="card p-5">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="eyebrow">{range.label}</h3>
                <span className="truncate text-xs text-slate-400">{range.dateLabel}</span>
              </div>
              <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">
                {inr(range.netSales)}
              </p>
              <p className="text-xs text-slate-500">Net sales · {range.invoiceCount} invoices</p>
              <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-sm">
                <span className="text-slate-500">Gross profit</span>
                <span className="font-semibold text-slate-900 tabular-nums">
                  {inr(range.grossProfit)}
                  {range.margin !== null ? (
                    <span className={`ml-2 text-xs font-medium ${range.grossProfit < 0 ? "text-rose-600" : "text-emerald-700"}`}>
                      {range.margin.toFixed(1)}%
                    </span>
                  ) : null}
                </span>
              </div>
            </div>
          ))}
        </div>

        {ranges.length > 0 ? (
          <div className="card overflow-x-auto">
            <div className="border-b border-slate-200 px-5 py-3">
              <h3 className="text-sm font-semibold text-slate-900">Breakdown</h3>
            </div>
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="eyebrow px-5 py-2.5 text-left font-semibold">Metric</th>
                  {ranges.map((range) => (
                    <th key={range.label} className="eyebrow px-5 py-2.5 text-right font-semibold">
                      {range.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.label} className={row.emphasis ? "bg-slate-50/60" : ""}>
                    <td className={`px-5 py-2.5 ${row.emphasis ? "font-semibold text-slate-900" : "text-slate-600"}`}>
                      {row.label}
                    </td>
                    {ranges.map((range) => {
                      const value = row.value(range);
                      return (
                        <td
                          key={range.label}
                          className={`px-5 py-2.5 text-right tabular-nums ${row.emphasis ? "font-semibold" : ""} ${value < 0 ? "text-rose-600" : "text-slate-900"}`}
                        >
                          {inr(value)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr>
                  <td className="px-5 py-2.5 text-slate-600">Invoices</td>
                  {ranges.map((range) => (
                    <td key={range.label} className="px-5 py-2.5 text-right text-slate-900 tabular-nums">
                      {range.invoiceCount.toLocaleString("en-IN")}
                    </td>
                  ))}
                </tr>
                {hasUnpaid ? (
                  <tr>
                    <td className="px-5 py-2.5 text-slate-600">
                      Still owed on these sales <span className="text-xs text-slate-400">(credit, included above)</span>
                    </td>
                    {ranges.map((range) => (
                      <td key={range.label} className="px-5 py-2.5 text-right text-amber-700 tabular-nums">
                        {range.unpaidSales > 0 ? inr(range.unpaidSales) : "—"}
                      </td>
                    ))}
                  </tr>
                ) : null}
                <tr className="border-t border-slate-200 bg-slate-50">
                  <td colSpan={ranges.length + 1} className="eyebrow px-5 py-2.5 font-semibold">
                    Money collected <span className="normal-case text-slate-400">(payments taken in the period, for bills of any date)</span>
                  </td>
                </tr>
                {collectionRows.map((row) => (
                  <tr key={row.label}>
                    <td className="px-5 py-2.5 text-slate-600">{row.label}</td>
                    {ranges.map((range) => (
                      <td key={range.label} className="px-5 py-2.5 text-right text-slate-900 tabular-nums">
                        {inr(row.value(range))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </section>
  );
}
