import { useQuery } from "@tanstack/react-query";
import { gstStateLabel } from "@pos/contracts";
import { api, apiErrorMessage, authHeaders } from "../../lib/api";
import { Problems, ReportStatus, Table, type GstPeriod } from "./shared";

/** GSTR-1: a preview of every section, what to fix, and the JSON file to upload. */
export function Gstr1View({ gstin, period }: { gstin: string; period: GstPeriod }) {
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
    <>
      <div className="card p-5">
        <p className="text-sm text-slate-600">
          Outward supplies. Fix any errors, then download the JSON and upload it on the GST portal. Import it into the GST
          offline tool first to check it.
        </p>
        <div className="mt-3">
          <ReportStatus isFetching={report.isFetching} error={report.error} />
        </div>
        {data ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              className="btn-primary"
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

      <Problems problems={data?.problems ?? []} />

      {data ? (
        <div className="grid gap-4">
          <Table
            title="B2B: invoices to registered buyers"
            headers={["Buyer GSTIN", "Invoice", "Date", "Place of supply", "Invoice value"]}
            rows={data.summary.b2b.map((r) => [r.ctin, r.inum, r.idt, gstStateLabel(r.pos), r.val])}
            empty="None. Customers with a GSTIN are registered buyers; their sales are listed here."
          />
          <Table
            title="Credit notes to registered buyers (CDNR)"
            headers={["Buyer GSTIN", "Credit note", "Date", "Place of supply", "Value"]}
            rows={data.summary.cdnr.map((r) => [r.ctin, r.nt_num, r.nt_dt, gstStateLabel(r.pos), r.val])}
            empty="None."
          />
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
            rows={data.summary.nil.map((r) => [
              `${r.sply_ty.startsWith("INTRB") ? "Inter-state" : "Intra-state"}, ${r.sply_ty.endsWith("B2B") ? "registered" : "unregistered"}`,
              r.nil_amt,
              r.expt_amt,
              r.ngsup_amt,
            ])}
            empty="None."
          />
          <Table
            title="HSN summary"
            headers={["Buyers", "HSN", "Description", "UQC", "Quantity", "Rate %", "Taxable value", "IGST", "CGST", "SGST"]}
            rows={data.summary.hsn.map((r) => [
              (r as { typ?: string }).typ === "B2B" ? "Registered" : "Unregistered",
              r.hsn_sc,
              r.desc,
              r.uqc,
              String(r.qty),
              String(r.rt),
              r.txval,
              r.iamt,
              r.camt,
              r.samt,
            ])}
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
    </>
  );
}
