import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { financialYearLabel, financialYearStart } from "@pos/contracts";
import { api, authHeaders } from "../lib/api";
import { Gstr1View } from "./gst/Gstr1View";
import { CompositionView } from "./gst/CompositionView";
import { Gstr3bView } from "./gst/Gstr3bView";
import { requireAdmin } from "./route-helpers";

type PeriodKind = "month" | "quarter";
type ReturnKind = "GSTR1" | "GSTR3B" | "CMP08" | "GSTR4";

const QUARTERS = [
  { label: "April - June", months: [4, 6] },
  { label: "July - September", months: [7, 9] },
  { label: "October - December", months: [10, 12] },
  { label: "January - March", months: [1, 3] },
] as const;

const pad = (n: number) => String(n).padStart(2, "0");

/** GST returns for a GSTIN and period: GSTR-1 and GSTR-3B (regular), CMP-08 and GSTR-4 (composition). */
export function GstReturnsPage() {
  requireAdmin();
  const today = useMemo(() => new Date(), []);
  const [gstin, setGstin] = useState("");
  const [returnKind, setReturnKind] = useState<ReturnKind>("GSTR1");
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

  // CMP-08 is always for a quarter; GSTR-4 for a whole financial year.
  const periodKind: PeriodKind | "year" = returnKind === "CMP08" ? "quarter" : returnKind === "GSTR4" ? "year" : kind;
  const period = useMemo(() => {
    if (periodKind === "year") return { from: `${fyStart}-04`, to: `${fyStart + 1}-03` };
    if (periodKind === "month") return { from: month, to: month };
    const [first, last] = QUARTERS[quarter].months;
    const year = first <= 3 ? fyStart + 1 : fyStart;
    return { from: `${year}-${pad(first)}`, to: `${year}-${pad(last)}` };
  }, [periodKind, month, fyStart, quarter]);

  return (
    <section className="mx-auto max-w-7xl space-y-4 p-6">
      <div className="card p-5">
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">GST Returns</h2>
        <p className="mt-1 text-sm text-slate-500">
          Figures for one GSTIN from the sales and returns recorded here. Check them, and have your accountant review them
          before filing.
        </p>

        <div className="mt-4 grid gap-3 md:grid-cols-5">
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Return
            <select className="field" value={returnKind} onChange={(e) => setReturnKind(e.target.value as ReturnKind)}>
              <option value="GSTR1">GSTR-1 (outward supplies)</option>
              <option value="GSTR3B">GSTR-3B (summary)</option>
              <option value="CMP08">CMP-08 (composition, quarterly)</option>
              <option value="GSTR4">GSTR-4 (composition, yearly)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            GSTIN
            <select className="field" value={gstin} onChange={(e) => setGstin(e.target.value)}>
              {(gstins.data ?? []).map((g) => (
                <option key={g.gstin} value={g.gstin}>
                  {g.gstin} ({g.label})
                </option>
              ))}
            </select>
          </label>
          {returnKind === "GSTR1" || returnKind === "GSTR3B" ? (
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Filing
              <select className="field" value={kind} onChange={(e) => setKind(e.target.value as PeriodKind)}>
                <option value="month">Monthly</option>
                <option value="quarter">Quarterly (QRMP)</option>
              </select>
            </label>
          ) : null}
          {periodKind === "month" ? (
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Month
              <input type="month" className="field" value={month} onChange={(e) => setMonth(e.target.value)} />
            </label>
          ) : (
            <>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                Financial year
                <select className="field" value={fyStart} onChange={(e) => setFyStart(Number(e.target.value))}>
                  {[currentFy, currentFy - 1, currentFy - 2].map((year) => (
                    <option key={year} value={year}>
                      {financialYearLabel(year)}
                    </option>
                  ))}
                </select>
              </label>
              {periodKind === "quarter" ? (
                <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                  Quarter
                  <select className="field" value={quarter} onChange={(e) => setQuarter(Number(e.target.value))}>
                    {QUARTERS.map((q, idx) => (
                      <option key={q.label} value={idx}>
                        {q.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </>
          )}
        </div>

        {gstins.data && gstins.data.length === 0 ? (
          <p className="mt-4 text-sm text-amber-700">No GSTIN yet: set one in Business Settings or on a branch.</p>
        ) : null}
      </div>

      {gstin ? (
        returnKind === "GSTR1" ? (
          <Gstr1View gstin={gstin} period={period} />
        ) : returnKind === "GSTR3B" ? (
          <Gstr3bView gstin={gstin} period={period} />
        ) : (
          <CompositionView gstin={gstin} kind={returnKind} period={period} fy={fyStart} />
        )
      ) : null}
    </section>
  );
}
