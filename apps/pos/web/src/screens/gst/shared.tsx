/** Pieces shared by the GST return views. */
export type GstPeriod = { from: string; to: string };
export type GstProblem = { severity: "error" | "warning"; message: string };

export const amount = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A titled table; numbers are shown as money, right-aligned. */
export function Table({ title, headers, rows, empty }: { title: string; headers: string[]; rows: Array<Array<string | number>>; empty: string }) {
  return (
    <div className="card overflow-hidden">
      <p className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">{title}</p>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-slate-500">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="eyebrow bg-slate-50">
              <tr className="border-b border-slate-200">
                {headers.map((header, headerIdx) => (
                  // Numeric columns are right-aligned, so their headings are too.
                  <th key={header} className={`px-4 py-2 font-semibold ${typeof rows[0]?.[headerIdx] === "number" ? "text-right" : ""}`}>
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx} className="border-t border-slate-100 first:border-t-0 hover:bg-slate-50">
                  {row.map((cell, cellIdx) => (
                    <td key={cellIdx} className={`px-4 py-2 ${typeof cell === "number" ? "text-right text-slate-900 tabular-nums" : "text-slate-700"}`}>
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
          className={`rounded-md border px-4 py-2 text-sm ${
            problem.severity === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-amber-200 bg-amber-50 text-amber-900"
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
  if (error) return <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{(error as Error).message}</p>;
  if (isFetching) return <p className="text-sm text-slate-500">Preparing…</p>;
  return null;
}
