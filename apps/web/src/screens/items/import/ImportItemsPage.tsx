import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ITEM_IMPORT_COLUMNS } from "@pos/contracts";
import { useState } from "react";
import { BranchPicker } from "../../../components/BranchPicker";
import { api, apiErrorMessage, authHeaders } from "../../../lib/api";
import { useManagedBranch } from "../../../lib/branch";
import { requireManagementSession } from "../../route-helpers";
import { parseCsv, tableToImport, templateCsv, type ImportTable } from "./spreadsheet";

const MAX_ROWS = 5000;
type Result = { applied: boolean; created: number; updated: number; errors: Array<{ row: number; message: string }>; warnings: Array<{ row: number; message: string }> };

function download(name: string, content: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type: "text/csv" }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

/** A CSV or Excel file's first sheet as a table of cells. */
async function readFile(file: File): Promise<unknown[][]> {
  if (/\.xlsx$/i.test(file.name)) {
    const { default: readXlsxFile } = await import("read-excel-file");
    return readXlsxFile(file);
  }
  if (/\.xls$/i.test(file.name)) throw new Error("Old .xls files can't be read: save it as .xlsx or CSV in Excel first.");
  return parseCsv(await file.text());
}

/**
 * Items from a spreadsheet: the template, a CSV or Excel file, a check of every row, then the
 * import. Codes already there update those items (blank cells leave them as they are); opening
 * stock and reorder levels go to the branch chosen.
 */
export function ImportItemsPage() {
  requireManagementSession();
  const queryClient = useQueryClient();
  const [managedBranch, setManagedBranch] = useManagedBranch();
  const branchId = managedBranch ?? "";
  const [fileName, setFileName] = useState("");
  const [table, setTable] = useState<ImportTable | null>(null);
  const [readError, setReadError] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  const send = useMutation({
    mutationFn: async (dryRun: boolean) => {
      const res = await api.items.import({ body: { branchId, dryRun, rows: table!.rows }, extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "The file couldn't be imported."));
      return res.body;
    },
    onSuccess: async (body) => {
      setResult(body);
      if (body.applied) {
        await Promise.all(["items-module", "items-pos", "items-stock-list", "item-groups", "stock-module", "low-stock"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
      }
    },
  });

  const onFile = async (file: File | undefined) => {
    setTable(null);
    setResult(null);
    setReadError("");
    send.reset();
    if (!file) return;
    setFileName(file.name);
    try {
      const read = tableToImport(await readFile(file));
      if (!read.fields.includes("code")) throw new Error("The first row must name the columns, with a Code column. Start from the template.");
      if (read.rows.length === 0) throw new Error("The file has no items below its header row.");
      if (read.rows.length > MAX_ROWS) throw new Error(`The file has ${read.rows.length} items: import at most ${MAX_ROWS} at a time.`);
      setTable(read);
    } catch (error) {
      setReadError((error as Error).message);
    }
  };

  const checked = result && !result.applied && result.errors.length === 0;
  return (
    <section className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="page-title">Import Items</h2>
          <p className="text-sm text-slate-500">
            From a CSV or Excel (.xlsx) file. <Link to="/items" className="text-brand-700 hover:underline">Back to items</Link>
          </p>
        </div>
        <BranchPicker value={branchId} onChange={setManagedBranch} className="w-56" />
      </div>

      <div className="card grid gap-4 p-5 md:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">1. Fill in the template</h3>
          <p className="mt-1 text-sm text-slate-600">One item a row, the first row naming the columns. Codes already there update those items: blank cells leave them as they are.</p>
          <button className="btn-secondary mt-3" type="button" onClick={() => download("items-template.csv", templateCsv())}>
            Download Template
          </button>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-900">2. Choose the file</h3>
          <p className="mt-1 text-sm text-slate-600">Opening stock and reorder levels go to this branch.</p>
          <input className="mt-3 block text-sm" type="file" accept=".csv,.xlsx,text/csv" aria-label="Spreadsheet file" onChange={(e) => void onFile(e.target.files?.[0])} />
        </div>
        <details className="text-sm text-slate-600 md:col-span-2">
          <summary className="cursor-pointer font-medium text-slate-700">The columns</summary>
          <table className="mt-2 w-full text-left text-xs">
            <tbody>
              {ITEM_IMPORT_COLUMNS.map((column) => (
                <tr key={column.field} className="border-b border-slate-100">
                  <td className="py-1 pr-3 font-semibold whitespace-nowrap">{column.header}</td>
                  <td className="py-1">{column.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>

      {readError ? <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{readError}</p> : null}

      {table ? (
        <div className="card space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-700">
              <span className="font-semibold">{fileName}</span>: {table.rows.length} {table.rows.length === 1 ? "item" : "items"}
              {table.ignored.length > 0 ? <span className="text-slate-500"> · columns not read: {table.ignored.join(", ")}</span> : null}
            </p>
            <div className="flex gap-2">
              <button className="btn-secondary" type="button" disabled={send.isPending || !branchId} onClick={() => send.mutate(true)}>
                {send.isPending && send.variables ? "Checking…" : "Check"}
              </button>
              <button className="btn-primary" type="button" disabled={send.isPending || !checked} onClick={() => send.mutate(false)}>
                {send.isPending && send.variables === false ? "Importing…" : "Import"}
              </button>
            </div>
          </div>
          {send.error ? <p className="text-sm text-rose-700" role="alert">{(send.error as Error).message}</p> : null}
          {result ? (
            <div className="space-y-3">
              <p className={`rounded-md px-3 py-2 text-sm ${result.applied ? "bg-emerald-50 text-emerald-800" : result.errors.length ? "bg-rose-50 text-rose-800" : "bg-slate-50 text-slate-800"}`} role="status">
                {result.applied
                  ? `Imported: ${result.created} added, ${result.updated} updated.`
                  : result.errors.length
                    ? `${result.errors.length} ${result.errors.length === 1 ? "problem" : "problems"} to fix in the file; nothing was saved.`
                    : `Ready: ${result.created} to add, ${result.updated} to update. Press Import to save them.`}
              </p>
              {[...result.errors.map((issue) => ({ ...issue, kind: "error" })), ...result.warnings.map((issue) => ({ ...issue, kind: "warning" }))].length > 0 ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="eyebrow border-b border-slate-200 text-left">
                      <th className="w-20 py-2">Row</th>
                      <th className="py-2">Problem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...result.errors.map((issue) => ({ ...issue, kind: "error" as const })), ...result.warnings.map((issue) => ({ ...issue, kind: "warning" as const }))]
                      .sort((a, b) => a.row - b.row)
                      .slice(0, 500)
                      .map((issue, index) => (
                        <tr key={index} className="border-b border-slate-100">
                          <td className="py-1.5 tabular-nums">{issue.row}</td>
                          <td className={`py-1.5 ${issue.kind === "error" ? "text-rose-700" : "text-amber-700"}`}>{issue.message}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
