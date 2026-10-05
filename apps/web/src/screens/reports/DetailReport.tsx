import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, apiErrorMessage, authHeaders } from "../../lib/api";
import { inr } from "../route-helpers";

type Tab = "items" | "categories" | "cashiers" | "registers";
type Cell = string | number | null;

/** Today in the business time zone, as YYYY-MM-DD. */
function today(timeZone?: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
}

function formatDateTime(value: string | Date | null, timeZone?: string) {
  if (!value) return "Open";
  return new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone });
}

/** Saves rows as a CSV file (Excel-friendly: BOM, quoted cells, no formulas). */
function downloadCsv(name: string, header: string[], rows: Cell[][]) {
  const cell = (value: Cell) => {
    const text = value === null ? "" : String(value);
    const safe = /^[=+\-@]/.test(text) && typeof value !== "number" ? `'${text}` : text;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const csv = "﻿" + [header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

/**
 * The owner's report for any period: sales by item, category and cashier, discounts, and each
 * register's day-end (Z) figures, for the branch chosen above or all of them, with CSV downloads.
 */
export function DetailReport({ branchId, timeZone }: { branchId: string | null; timeZone?: string }) {
  const [from, setFrom] = useState(() => today(timeZone));
  const [to, setTo] = useState(() => today(timeZone));
  const [touched, setTouched] = useState(false);
  const [tab, setTab] = useState<Tab>("items");
  // Until someone picks dates, the period is today in the business time zone (known once loaded).
  useEffect(() => {
    if (touched || !timeZone) return;
    setFrom(today(timeZone));
    setTo(today(timeZone));
  }, [timeZone, touched]);

  const report = useQuery({
    queryKey: ["reports-detail", branchId, from, to],
    enabled: !!from && !!to && from <= to,
    queryFn: async () => {
      const res = await api.reports.detail({
        query: { from, to, ...(branchId ? { branchId } : {}) },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "Failed to load the report"));
      return res.body;
    },
  });
  const data = report.data;
  const fileName = (what: string) => `${what}-${from}-to-${to}.csv`;

  const tables: Record<Tab, { header: string[]; rows: Cell[][]; money: number[] }> = {
    items: {
      header: ["Item", "Category", "Qty", "Sales (before tax)", "Tax", "Cost", "Profit"],
      rows: (data?.items ?? []).map((row) => [row.itemName, row.category, row.qty, row.sales, row.tax, row.cost, row.profit]),
      money: [3, 4, 5, 6],
    },
    categories: {
      header: ["Category", "Qty", "Sales (before tax)", "Tax", "Cost", "Profit"],
      rows: (data?.categories ?? []).map((row) => [row.category ?? "Uncategorised", row.qty, row.sales, row.tax, row.cost, row.profit]),
      money: [2, 3, 4, 5],
    },
    cashiers: {
      header: ["Cashier", "Bills", "Sales (with tax)", "Returns given"],
      rows: (data?.cashiers ?? []).map((row) => [row.name, row.invoices, row.sales, row.returns]),
      money: [2, 3],
    },
    registers: {
      header: ["Branch", "Counter", "Opened by", "Opened", "Closed", "Opening cash", "Cash sales", "Cash top-ups", "Cash refunds", "Paid to suppliers", "Card", "UPI", "Expected cash", "Counted", "Difference"],
      rows: (data?.registers ?? []).map((row) => [
        row.branchName,
        row.counterName,
        row.openedBy,
        formatDateTime(row.openedAt, timeZone),
        formatDateTime(row.closedAt, timeZone),
        row.openingBalance,
        row.cashSales,
        row.cashTopups,
        row.cashRefunds,
        row.cashPaidOut,
        row.cardSales,
        row.upiSales,
        row.expectedCash,
        row.closingBalance,
        row.cashDifference,
      ]),
      money: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
    },
  };
  const current = tables[tab];
  const tabLabels: Record<Tab, string> = { items: "Items", categories: "Categories", cashiers: "Cashiers", registers: "Registers (day-end)" };

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 px-5 py-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Detailed report</h3>
          <p className="text-xs text-slate-500">Any period, net of returns made in it. Days in the business time zone.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-600">
            From
            <input className="field mt-1" type="date" value={from} onChange={(e) => { setTouched(true); setFrom(e.target.value); }} />
          </label>
          <label className="text-xs text-slate-600">
            To
            <input className="field mt-1" type="date" value={to} onChange={(e) => { setTouched(true); setTo(e.target.value); }} />
          </label>
          <button
            type="button"
            className="btn-secondary"
            disabled={!data || current.rows.length === 0}
            onClick={() => downloadCsv(fileName(tab), current.header, current.rows)}
          >
            Download CSV
          </button>
        </div>
      </div>

      {data ? (
        <div className="grid grid-cols-2 gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3 text-sm md:grid-cols-6">
          <div><p className="eyebrow">Sales (with tax)</p><p className="font-semibold tabular-nums">{inr(data.summary.grossSales)}</p></div>
          <div><p className="eyebrow">Bills</p><p className="font-semibold tabular-nums">{data.summary.invoiceCount}</p></div>
          <div><p className="eyebrow">Gross profit</p><p className="font-semibold tabular-nums">{inr(data.summary.grossProfit)}</p></div>
          <div><p className="eyebrow">Discounts given</p><p className="font-semibold tabular-nums">{inr(data.discounts.item + data.discounts.order)}</p></div>
          <div><p className="eyebrow">Cash / Card / UPI</p><p className="font-semibold tabular-nums">{inr(data.summary.collections.cash)} / {inr(data.summary.collections.card)} / {inr(data.summary.collections.upi)}</p></div>
          <div><p className="eyebrow">Still owed</p><p className="font-semibold tabular-nums">{inr(data.summary.unpaidSales)}</p></div>
        </div>
      ) : null}

      <div className="flex gap-1 border-b border-slate-200 px-3 pt-2">
        {(Object.keys(tabLabels) as Tab[]).map((key) => (
          <button
            key={key}
            type="button"
            className={`rounded-t-md px-3 py-1.5 text-sm font-medium ${tab === key ? "bg-white text-brand-700 ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-800"}`}
            onClick={() => setTab(key)}
          >
            {tabLabels[key]}
          </button>
        ))}
      </div>

      {from > to ? (
        <p className="px-5 py-4 text-sm text-rose-700">The period must end on or after its start.</p>
      ) : report.isLoading ? (
        <p className="px-5 py-4 text-sm text-slate-500">Loading…</p>
      ) : report.error ? (
        <p className="px-5 py-4 text-sm text-rose-700">{(report.error as Error).message}</p>
      ) : current.rows.length === 0 ? (
        <p className="px-5 py-4 text-sm text-slate-500">Nothing in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                {current.header.map((label, index) => (
                  <th key={label} className={`eyebrow px-4 py-2 font-semibold ${index === 0 ? "text-left" : "text-right"}`}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {current.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((value, index) => (
                    <td
                      key={index}
                      className={`px-4 py-2 tabular-nums ${index === 0 ? "text-left text-slate-900" : "text-right"} ${typeof value === "number" && value < 0 ? "text-rose-600" : "text-slate-800"}`}
                    >
                      {value === null ? "—" : current.money.includes(index) && typeof value === "number" ? inr(value) : value}
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
