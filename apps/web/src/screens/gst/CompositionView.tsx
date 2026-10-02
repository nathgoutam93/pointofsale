import { useQuery } from "@tanstack/react-query";
import { COMPOSITION_CATEGORY_LABELS, financialYearLabel } from "@pos/contracts";
import { api, apiErrorMessage, authHeaders } from "../../lib/api";
import { amount, Problems, ReportStatus, Table, type GstPeriod } from "./shared";

const QUARTER_NAMES = ["April - June", "July - September", "October - December", "January - March"];

/**
 * A composition taxpayer's returns: CMP-08 for a quarter, or GSTR-4 for a financial year
 * (with its quarters). Turnover and the tax due at the composition rate, to enter on the portal.
 */
export function CompositionView({ gstin, kind, period, fy }: { gstin: string; kind: "CMP08" | "GSTR4"; period: GstPeriod; fy: number }) {
  const report = useQuery({
    queryKey: [kind, gstin, period.from, period.to, fy],
    queryFn: async () => {
      if (kind === "CMP08") {
        const res = await api.gst.cmp08({ query: { gstin, ...period }, extraHeaders: authHeaders() });
        if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "Failed to prepare CMP-08"));
        return res.body;
      }
      const res = await api.gst.gstr4({ query: { gstin, fy }, extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "Failed to prepare GSTR-4"));
      return res.body;
    },
  });
  const data = report.data;

  return (
    <>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-600">
          {kind === "CMP08"
            ? "CMP-08 for the quarter: sales made as a composition taxpayer, net of returns, and the tax due on them at the composition rate. Traders pay on taxable supplies only; others on all their turnover."
            : `GSTR-4 for ${financialYearLabel(fy)}: the year's outward supplies by rate, and quarter by quarter (as filed in CMP-08).`}
        </p>
        <div className="mt-3">
          <ReportStatus isFetching={report.isFetching} error={report.error} />
        </div>
        {data ? (
          <p className="mt-3 text-sm text-slate-600">
            Business turnover this financial year (all GSTINs): ₹ {amount(data.yearTurnover)}
          </p>
        ) : null}
      </div>

      <Problems problems={data?.problems ?? []} />

      {data ? (
        <div className="grid gap-4">
          <Table
            title={kind === "CMP08" ? "Outward supplies (including exempt supplies)" : "Outward supplies by composition rate"}
            headers={["Category", "Rate %", "Turnover", "Taxable turnover", "Tax on", "CGST", "SGST"]}
            rows={[
              ...data.rows.map((r) => [COMPOSITION_CATEGORY_LABELS[r.category], String(r.rate), r.turnover, r.taxableTurnover, r.taxBase, r.cgst, r.sgst]),
              ...(data.rows.length > 1 ? [["Total", "", data.totals.turnover, "", data.totals.taxBase, data.totals.cgst, data.totals.sgst]] : []),
            ]}
            empty="No composition sales in this period."
          />
          {data.byQuarter ? (
            <Table
              title="Quarter by quarter (CMP-08)"
              headers={["Quarter", "Turnover", "Tax on", "CGST", "SGST"]}
              rows={data.byQuarter.map((q) => [QUARTER_NAMES[q.quarter - 1], q.turnover, q.taxBase, q.cgst, q.sgst])}
              empty=""
            />
          ) : null}
        </div>
      ) : null}
    </>
  );
}
