import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { financialYearLabel, financialYearStart, gstStateLabel } from "@pos/contracts";
import { api, apiErrorMessage, authHeaders } from "../lib/api";
import { requireAdmin } from "./route-helpers";

type PeriodKind = "month" | "quarter";

const QUARTERS = [
  { label: "April - June", months: [4, 6] },
  { label: "July - September", months: [7, 9] },
  { label: "October - December", months: [10, 12] },
  { label: "January - March", months: [1, 3] },
] as const;

const pad = (n: number) => String(n).padStart(2, "0");
const amount = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Table({ title, headers, rows, empty }: { title: string; headers: string[]; rows: Array<Array<string | number>>; empty: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <p className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-800">{title}</p>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-slate-500">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {headers.map((header) => (
                  <th key={header} className="px-4 py-2">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx} className="border-t border-slate-100">
                  {row.map((cell, cellIdx) => (
                    <td key={cellIdx} className={`px-4 py-2 ${typeof cell === "number" ? "text-right tabular-nums" : ""}`}>
                      {typeof cell === "number" ? amount(cell) : cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** GSTR-1 for a GSTIN and period: a preview, what to fix, and the JSON file to upload. */
export function GstReturnsPage() {
  requireAdmin();
  const today = useMemo(() => new Date(), []);
  const [gstin, setGstin] = useState("");
  const [kind, setKind] = useState<PeriodKind>("month");
  // Last month by default: returns are filed for a month that has ended.
  const [month, setMonth] = useState(() => {
    const d = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  });
  const currentFy = financialYearStart(today.getFullYear(), today.getMonth() + 1);
  const [fyStart, setFyStart] = useState(currentFy);
  const [quarter, setQuarter] = useState(0);

  const gstins = useQuery({
    queryKey: ["gst-gstins"],
    queryFn: async () => {
      const res = await api.gst.gstins({ extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error("Failed to load GSTINs");
      return res.body;
    },
  });
  useEffect(() => {
    if (!gstin && gstins.data?.length) setGstin(gstins.data[0].gstin);
  }, [gstin, gstins.data]);

  const period = useMemo(() => {
    if (kind === "month") return { from: month, to: month };
    const [first, last] = QUARTERS[quarter].months;
    const year = first <= 3 ? fyStart + 1 : fyStart;
    return { from: `${year}-${pad(first)}`, to: `${year}-${pad(last)}` };
  }, [kind, month, fyStart, quarter]);

  const report = useQuery({
    queryKey: ["gstr1", gstin, period.from, period.to],
    enabled: !!gstin && /^\d{4}-\d{2}$/.test(period.from),
    queryFn: async () => {
      const res = await api.gst.gstr1({ query: { gstin, ...period }, extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "Failed to prepare GSTR-1"));
      return res.body;
    },
  });

  const data = report.data;
  const errors = data?.problems.filter((p) => p.severity === "error") ?? [];
  const warnings = data?.problems.filter((p) => p.severity === "warning") ?? [];

  const download = () => {
    if (!data) return;
    const fp = String(data.json.fp ?? "");
    const blob = new Blob([JSON.stringify(data.json, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `GSTR1_${data.gstin}_${fp}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <section className="mx-auto max-w-6xl space-y-4 p-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-2xl font-semibold text-slate-900">GST Returns: GSTR-1</h2>
        <p className="mt-1 text-sm text-slate-600">
          Outward supplies for one GSTIN. Check the preview, fix any errors, then download the JSON and upload it on the GST
          portal. Import it into the GST offline tool first, and have your accountant review it before filing.
        </p>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            GSTIN
            <select className="rounded border border-slate-300 px-3 py-2" value={gstin} onChange={(e) => setGstin(e.target.value)}>
              {(gstins.data ?? []).map((g) => (
                <option key={g.gstin} value={g.gstin}>
                  {g.gstin} ({g.label})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            Filing
            <select className="rounded border border-slate-300 px-3 py-2" value={kind} onChange={(e) => setKind(e.target.value as PeriodKind)}>
              <option value="month">Monthly</option>
              <option value="quarter">Quarterly (QRMP)</option>
            </select>
          </label>
          {kind === "month" ? (
            <label className="flex flex-col gap-1 text-sm text-slate-600">
              Month
              <input type="month" className="rounded border border-slate-300 px-3 py-2" value={month} onChange={(e) => setMonth(e.target.value)} />
            </label>
          ) : (
            <>
              <label className="flex flex-col gap-1 text-sm text-slate-600">
                Financial year
                <select className="rounded border border-slate-300 px-3 py-2" value={fyStart} onChange={(e) => setFyStart(Number(e.target.value))}>
                  {[currentFy, currentFy - 1, currentFy - 2].map((year) => (
                    <option key={year} value={year}>
                      {financialYearLabel(year)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-600">
                Quarter
                <select className="rounded border border-slate-300 px-3 py-2" value={quarter} onChange={(e) => setQuarter(Number(e.target.value))}>
                  {QUARTERS.map((q, idx) => (
                    <option key={q.label} value={idx}>
                      {q.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>

        {gstins.data && gstins.data.length === 0 ? (
          <p className="mt-4 text-sm text-amber-700">No GSTIN yet: set one in Business Settings or on a branch.</p>
        ) : null}
        {report.error ? <p className="mt-4 text-sm text-red-700">{(report.error as Error).message}</p> : null}
        {report.isFetching ? <p className="mt-4 text-sm text-slate-500">Preparing…</p> : null}

        {data ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-300"
              onClick={download}
              disabled={errors.length > 0}
            >
              Download GSTR-1 JSON
            </button>
            <p className="text-sm text-slate-600">
              {data.summary.invoices} invoices, {data.summary.cancelledInvoices} cancelled, {data.summary.creditNotes} credit notes
              {errors.length > 0 ? " · fix the errors below to download" : ""}
            </p>
          </div>
        ) : null}
      </div>

      {errors.length + warnings.length > 0 ? (
        <div className="space-y-2">
          {[...errors, ...warnings].map((problem, idx) => (
            <p
              key={idx}
              className={`rounded-lg border px-4 py-2 text-sm ${
                problem.severity === "error" ? "border-rose-300 bg-rose-50 text-rose-800" : "border-amber-300 bg-amber-50 text-amber-900"
              }`}
            >
              <strong>{problem.severity === "error" ? "Error: " : "Warning: "}</strong>
              {problem.message}
            </p>
          ))}
        </div>
      ) : null}

      {data ? (
        <div className="grid gap-4">
          <Table
            title="B2C small (B2CS), net of returns"
            headers={["Supply", "Place of supply", "Rate %", "Taxable value", "IGST", "CGST", "SGST"]}
            rows={data.summary.b2cs.map((r) => [r.sply_ty === "INTER" ? "Inter-state" : "Intra-state", gstStateLabel(r.pos), String(r.rt), r.txval, r.iamt, r.camt, r.samt])}
            empty="No B2C small sales in this period."
          />
          <Table
            title="B2C large (B2CL): inter-state invoices above ₹1,00,000"
            headers={["Invoice", "Date", "Place of supply", "Invoice value"]}
            rows={data.summary.b2cl.map((r) => [r.inum, r.idt, gstStateLabel(r.pos), r.val])}
            empty="None."
          />
          <Table
            title="Credit notes for B2CL invoices (CDNUR)"
            headers={["Credit note", "Date", "Place of supply", "Value"]}
            rows={data.summary.cdnur.map((r) => [r.nt_num, r.nt_dt, gstStateLabel(r.pos), r.val])}
            empty="None. Returns of other sales are netted into B2CS and nil figures above."
          />
          <Table
            title="Nil rated, exempt and non-GST"
            headers={["Supply", "Nil rated", "Exempt", "Non-GST"]}
            rows={data.summary.nil.map((r) => [r.sply_ty === "INTRB2C" ? "Inter-state" : "Intra-state", r.nil_amt, r.expt_amt, r.ngsup_amt])}
            empty="None."
          />
          <Table
            title="HSN summary"
            headers={["HSN", "Description", "UQC", "Quantity", "Rate %", "Taxable value", "IGST", "CGST", "SGST"]}
            rows={data.summary.hsn.map((r) => [r.hsn_sc, r.desc, r.uqc, String(r.qty), String(r.rt), r.txval, r.iamt, r.camt, r.samt])}
            empty="None."
          />
          <Table
            title="Documents issued"
            headers={["Type", "From", "To", "Total", "Cancelled", "Net issued"]}
            rows={[
              ...data.summary.documents.invoices.map((d) => ["Invoices", d.from, d.to, String(d.totnum), String(d.cancel), String(d.net_issue)]),
              ...data.summary.documents.creditNotes.map((d) => ["Credit notes", d.from, d.to, String(d.totnum), String(d.cancel), String(d.net_issue)]),
            ]}
            empty="None."
          />
        </div>
      ) : null}
    </section>
  );
}
