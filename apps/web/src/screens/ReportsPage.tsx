import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, authHeaders } from "../lib/api";
import { money, requireAdmin } from "./route-helpers";

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

function formatShortDate(value: string) {
  return new Date(value).toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
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
      return {
        ...range,
        ...Object.fromEntries(SUMMED_FIELDS.map((key) => [key, sum(key)])),
      } as typeof range;
    });

    return {
      branchId: ALL_BRANCHES_OPTION,
      generatedAt,
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

  return (
    <section className="p-6">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
              Sales Report
            </p>
            <h2 className="text-2xl font-semibold text-slate-900">
              Sales, Cost, and Gross Profit
            </h2>
          </div>
          <div className="flex items-end gap-3">
            <label className="text-xs text-slate-600">
              Branch
              <select
                className="mt-1 block rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800"
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
            </label>
            <p className="text-xs text-slate-500">
              {isAllBranchesSelected
                ? "Viewing all branches"
                : selectedBranch
                  ? `Viewing ${selectedBranch.name}`
                  : "Viewing selected branch"}
              {summary?.generatedAt ? ` • Generated ${formatShortDate(summary.generatedAt)}` : ""}
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {(summary?.ranges ?? []).map((range) => {
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
                    <span className="text-slate-500">Sales incl. tax ({range.invoiceCount} paid)</span>
                    <span className="font-semibold">{money(range.grossSales)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Tax collected</span>
                    <span className="font-semibold">{money(range.taxCollected)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Returns before tax</span>
                    <span className="font-semibold">{money(range.returnsNet)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Net sales (excl. tax)</span>
                    <span className="font-semibold">{money(range.netSales)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Cost of goods sold</span>
                    <span className="font-semibold">{money(range.costOfGoodsSold)}</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                    <span className="text-slate-700">Gross profit</span>
                    <span className={`text-base font-semibold ${range.grossProfit < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                      {money(range.grossProfit)}
                    </span>
                  </div>
                  {range.unpaidSales > 0 ? (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">Unpaid credit sales (not counted)</span>
                      <span className="font-semibold text-amber-700">{money(range.unpaidSales)}</span>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        {isLoading ? (
          <p className="mt-6 text-sm text-slate-500">Loading report…</p>
        ) : hasError ? (
          <p className="mt-6 text-sm text-red-600">
            Failed to load report. Please try again.
          </p>
        ) : null}
      </div>
    </section>
  );
}
