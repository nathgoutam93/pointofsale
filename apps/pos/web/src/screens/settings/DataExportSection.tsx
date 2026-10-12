import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { apiErrorMessage, apiFetch } from "../../lib/api";
import { useIsOffline } from "../../lib/mode";

/** YYYY-MM-DD in `timeZone`. */
const calendarDate = (date: Date, timeZone?: string) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(date);

/** Saves a downloaded answer as a file, named as the server says (or `fallbackName`). */
async function saveAnswer(path: string, fallbackName: string) {
  const res = await apiFetch(path);
  if (!res.ok) throw new Error(apiErrorMessage(await res.json().catch(() => null), "The download failed."));
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return name;
}

/**
 * The business's data to take away: the sales register as CSV (for an accountant), and,
 * online, everything as a backup file an offline install restores. Offline businesses have
 * their backups under Backups.
 */
export function DataExportSection({ branches, timeZone }: { branches: Array<{ id: string; name: string; code: string }>; timeZone?: string }) {
  const offline = useIsOffline();
  const today = calendarDate(new Date(), timeZone);
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [branchId, setBranchId] = useState("");

  const sales = useMutation({
    mutationFn: () =>
      saveAnswer(`/exports/sales.csv?${new URLSearchParams({ from, to, ...(branchId ? { branchId } : {}) })}`, `sales-${from}-to-${to}.csv`),
  });
  const everything = useMutation({ mutationFn: () => saveAnswer("/exports/business", "pos-export.zip") });

  return (
    <div className="grid gap-4">
      <div className="card p-5">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">Sales register</h2>
        <p className="mt-1 text-sm text-slate-600">
          Every invoice and credit note in a period as a spreadsheet (CSV): customer, buyer GSTIN, taxable value, CGST, SGST,
          IGST, what was paid and what is still owed. For your accountant, or your own records.
        </p>
        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            sales.mutate();
          }}
        >
          <div>
            <label className="field-label" htmlFor="export-from">From</label>
            <input id="export-from" className="field" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} required />
          </div>
          <div>
            <label className="field-label" htmlFor="export-to">To</label>
            <input id="export-to" className="field" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} required />
          </div>
          {branches.length > 1 ? (
            <div>
              <label className="field-label" htmlFor="export-branch">Branch</label>
              <select id="export-branch" className="field" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">All my branches</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name} ({branch.code})
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <button className="btn-primary" type="submit" disabled={sales.isPending || !from || !to || from > to}>
            {sales.isPending ? "Preparing…" : "Download CSV"}
          </button>
        </form>
        {sales.isSuccess ? (
          <p className="mt-2 text-sm text-emerald-700" role="status">Saved {sales.data}.</p>
        ) : sales.error ? (
          <p className="mt-2 text-sm text-rose-700" role="alert">{(sales.error as Error).message}</p>
        ) : null}
      </div>

      {offline ? null : (
        <div className="card p-5">
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">Everything</h2>
          <p className="mt-1 text-sm text-slate-600">
            A copy of all of this business's data (every branch, item, customer, sale and setting, with logos and item pictures)
            as one backup file. Keep it safe: it is your business's records. To use it without the server, install the desktop
            app on a computer and choose “Restore from a backup” on its first screen.
          </p>
          <button className="btn-secondary mt-4" type="button" disabled={everything.isPending} onClick={() => everything.mutate()}>
            {everything.isPending ? "Preparing… (this can take a minute)" : "Download everything"}
          </button>
          {everything.isSuccess ? (
            <p className="mt-2 text-sm text-emerald-700" role="status">Saved {everything.data}.</p>
          ) : everything.error ? (
            <p className="mt-2 text-sm text-rose-700" role="alert">{(everything.error as Error).message}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
