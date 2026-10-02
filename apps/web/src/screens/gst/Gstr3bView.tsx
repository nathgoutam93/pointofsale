import { useQuery } from "@tanstack/react-query";
import { gstStateLabel } from "@pos/contracts";
import { api, apiErrorMessage, authHeaders } from "../../lib/api";
import { Problems, ReportStatus, Table, type GstPeriod } from "./shared";

/** The sales side of GSTR-3B: Tables 3.1 and 3.2, to copy into the return on the portal. */
export function Gstr3bView({ gstin, period }: { gstin: string; period: GstPeriod }) {
  const report = useQuery({
    queryKey: ["gstr3b", gstin, period.from, period.to],
    enabled: /^\d{4}-\d{2}$/.test(period.from),
    queryFn: async () => {
      const res = await api.gst.gstr3b({ query: { gstin, ...period }, extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "Failed to prepare GSTR-3B"));
      return res.body;
    },
  });
  const data = report.data;
  const row = (label: string, r: { txval: number; iamt: number; camt: number; samt: number; csamt: number }) => [label, r.txval, r.iamt, r.camt, r.samt, r.csamt];

  return (
    <>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-600">
          The sales figures for GSTR-3B, net of credit notes, from the same sales as GSTR-1. Enter them in the return on the
          GST portal along with your input tax credit.
        </p>
        <div className="mt-3">
          <ReportStatus isFetching={report.isFetching} error={report.error} />
        </div>
      </div>

      <Problems problems={data?.problems ?? []} />

      {data ? (
        <div className="grid gap-4">
          <Table
            title="3.1 Outward supplies and inward supplies liable to reverse charge"
            headers={["Nature of supplies", "Taxable value", "IGST", "CGST", "SGST", "Cess"]}
            rows={[
              row("(a) Outward taxable supplies (other than zero rated, nil rated and exempted)", data.table31.outwardTaxable),
              row("(b) Outward taxable supplies (zero rated)", data.table31.outwardZeroRated),
              row("(c) Other outward supplies (nil rated, exempted)", data.table31.outwardNilExempt),
              row("(d) Inward supplies (liable to reverse charge)", data.table31.inwardReverseCharge),
              row("(e) Non-GST outward supplies", data.table31.outwardNonGst),
            ]}
            empty=""
          />
          <Table
            title="3.2 Inter-state supplies to unregistered persons"
            headers={["Place of supply", "Taxable value", "IGST"]}
            rows={data.table32.unregistered.map((r) => [gstStateLabel(r.pos), r.txval, r.iamt])}
            empty="No inter-state supplies in this period."
          />
        </div>
      ) : null}
    </>
  );
}
