/** Pieces shared by the GST return views. */
export type GstPeriod = { from: string; to: string };
export type GstProblem = { severity: "error" | "warning"; message: string };

export const amount = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A titled table; numbers are shown as money, right-aligned. */
export function Table({ title, headers, rows, empty }: { title: string; headers: string[]; rows: Array<Array<string | number>>; empty: string }) {
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

/** Errors (to fix before filing) first, then warnings. */
export function Problems({ problems }: { problems: GstProblem[] }) {
  const sorted = [...problems.filter((p) => p.severity === "error"), ...problems.filter((p) => p.severity === "warning")];
  if (sorted.length === 0) return null;
  return (
    <div className="space-y-2">
      {sorted.map((problem, idx) => (
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
  );
}

/** Loading and failure states of a report query. */
export function ReportStatus({ isFetching, error }: { isFetching: boolean; error: unknown }) {
  if (error) return <p className="text-sm text-red-700">{(error as Error).message}</p>;
  if (isFetching) return <p className="text-sm text-slate-500">Preparing…</p>;
  return null;
}
