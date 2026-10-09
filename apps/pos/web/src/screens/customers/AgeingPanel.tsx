import { useQuery } from "@tanstack/react-query";
import { api, apiErrorMessage, authHeaders } from "../../lib/api";
import { inr } from "../route-helpers";

/** Everyone who owes at a branch, by how old the bills are; a row opens that customer. */
export function AgeingPanel({ branchId, onOpen }: { branchId: string; onOpen: (customerId: string) => void }) {
  const ageing = useQuery({
    queryKey: ["customers-ageing", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const res = await api.customers.ageing({ query: { branchId }, extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "Couldn't load what customers owe"));
      return res.body;
    },
  });

  const columns = [
    ["days0to30", "0–30 days"],
    ["days31to60", "31–60"],
    ["days61to90", "61–90"],
    ["over90", "Over 90"],
    ["total", "Owed"],
  ] as const;

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-900">What customers owe</h3>
        <p className="mt-0.5 text-xs text-slate-500">
          Unpaid bills by days since the sale. Overdue: past the customer's payment terms.
        </p>
      </div>
      {ageing.isLoading ? (
        <p className="p-5 text-sm text-slate-500">Loading…</p>
      ) : ageing.error ? (
        <p className="p-5 text-sm text-rose-700">{(ageing.error as Error).message}</p>
      ) : (ageing.data?.rows.length ?? 0) === 0 ? (
        <p className="p-5 text-sm text-slate-500">No customer owes anything.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="px-5 py-2 font-medium">Customer</th>
                {columns.map(([key, label]) => (
                  <th key={key} className="px-3 py-2 text-right font-medium">{label}</th>
                ))}
                <th className="px-5 py-2 text-right font-medium">Overdue</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {ageing.data!.rows.map((row) => (
                <tr key={row.customerId} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => onOpen(row.customerId)}>
                  <td className="px-5 py-2">
                    <p className="font-medium text-slate-900">{row.name}</p>
                    <p className="text-xs text-slate-500">
                      {row.code}
                      {row.creditLimit !== null ? ` · limit ${inr(row.creditLimit)}` : ""}
                    </p>
                  </td>
                  {columns.map(([key]) => (
                    <td key={key} className={`px-3 py-2 text-right ${key === "total" ? "font-semibold text-slate-900" : "text-slate-700"}`}>
                      {row[key] ? inr(row[key]) : "–"}
                    </td>
                  ))}
                  <td className={`px-5 py-2 text-right ${row.overdue > 0 ? "font-semibold text-rose-700" : "text-slate-400"}`}>
                    {row.overdue ? inr(row.overdue) : "–"}
                  </td>
                </tr>
              ))}
              <tr className="font-semibold text-slate-900">
                <td className="px-5 py-2">Total</td>
                {columns.map(([key]) => (
                  <td key={key} className="px-3 py-2 text-right">{inr(ageing.data!.totals[key])}</td>
                ))}
                <td className={`px-5 py-2 text-right ${ageing.data!.totals.overdue > 0 ? "text-rose-700" : ""}`}>{inr(ageing.data!.totals.overdue)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
