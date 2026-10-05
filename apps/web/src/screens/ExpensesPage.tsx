import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EXPENSE_CATEGORIES } from "@pos/contracts";
import { FormEvent, useState } from "react";
import { BranchPicker } from "../components/BranchPicker";
import { api, apiErrorMessage, authHeaders } from "../lib/api";
import { useManagedBranch } from "../lib/branch";
import { inr, requireManagementSession } from "./route-helpers";

type Mode = "CASH" | "UPI" | "BANK_TRANSFER" | "CHEQUE";
const MODES: Array<{ mode: Mode; label: string }> = [
  { mode: "CASH", label: "Cash" },
  { mode: "UPI", label: "UPI" },
  { mode: "BANK_TRANSFER", label: "Bank transfer" },
  { mode: "CHEQUE", label: "Cheque" },
];
const modeLabel = (mode: string) => MODES.find((option) => option.mode === mode)?.label ?? mode;

const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const today = () => localDate(new Date());
const monthStart = () => `${today().slice(0, 8)}01`;

/**
 * The expense book: what the branch spent (rent, electricity, tea...), paid in cash from a drawer
 * or otherwise, with totals by category for a period. Admins, and cashiers allowed to.
 */
export function ExpensesPage() {
  const session = requireManagementSession();
  const queryClient = useQueryClient();
  const [managedBranch, setManagedBranch] = useManagedBranch();
  const branchId = managedBranch ?? "";
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [adding, setAdding] = useState(false);
  const isAdmin = session.role === "ADMIN";

  const expenses = useQuery({
    queryKey: ["expenses", branchId, from, to],
    enabled: !!branchId && !!from && !!to,
    queryFn: async () => {
      const res = await api.expenses.list({ query: { branchId, from, to }, extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "Couldn't load the expenses."));
      return res.body;
    },
  });

  const remove = useMutation({
    mutationFn: async (input: { id: string; reason: string }) => {
      const res = await api.expenses.remove({ params: { id: input.id }, body: { reason: input.reason }, extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "The expense couldn't be removed."));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["expenses"] }),
  });

  const data = expenses.data;
  return (
    <section className="space-y-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="page-title">Expenses</h2>
          <p className="text-sm text-slate-500">What the branch spent, by the day it was paid. Cash paid from a drawer lowers the cash expected when it closes.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <BranchPicker value={branchId} onChange={setManagedBranch} className="w-56" />
          <div>
            <label className="field-label" htmlFor="expenses-from">From</label>
            <input id="expenses-from" className="field" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="expenses-to">To</label>
            <input id="expenses-to" className="field" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </div>
          <button className="btn-primary h-10" type="button" onClick={() => setAdding(true)} disabled={adding || !branchId}>
            Add Expense
          </button>
        </div>
      </div>

      {adding ? <ExpenseForm branchId={branchId} onDone={() => setAdding(false)} /> : null}

      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <div className="card p-5">
          <p className="eyebrow">Total</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{inr(data?.total ?? 0)}</p>
          <ul className="mt-4 space-y-2 text-sm">
            {(data?.byCategory ?? []).map((row) => (
              <li key={row.category} className="flex justify-between gap-3">
                <span className="truncate">
                  {row.category} <span className="text-xs text-slate-500">×{row.count}</span>
                </span>
                <span className="tabular-nums">{inr(row.total)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="card overflow-x-auto">
          {expenses.isLoading ? (
            <p className="p-5 text-sm text-slate-500">Loading…</p>
          ) : expenses.error ? (
            <p className="p-5 text-sm text-rose-700">{(expenses.error as Error).message}</p>
          ) : (data?.expenses.length ?? 0) === 0 ? (
            <p className="p-5 text-sm text-slate-500">No expenses in this period.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="eyebrow border-b border-slate-200 text-left">
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Category</th>
                  <th className="px-4 py-2">Paid by</th>
                  <th className="px-4 py-2">Details</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                  {isAdmin ? <th className="px-4 py-2" /> : null}
                </tr>
              </thead>
              <tbody>
                {data!.expenses.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100">
                    <td className="px-4 py-2 whitespace-nowrap">{row.date}</td>
                    <td className="px-4 py-2">{row.category}</td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {modeLabel(row.mode)}
                      {row.registerSessionId ? <span className="text-xs text-slate-500"> · drawer</span> : null}
                    </td>
                    <td className="px-4 py-2 text-slate-600">
                      {[row.reference, row.note].filter(Boolean).join(" · ")}
                      <span className="block text-xs text-slate-400">by {row.createdByName}</span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{inr(row.amount)}</td>
                    {isAdmin ? (
                      <td className="px-4 py-2 text-right">
                        <button
                          type="button"
                          className="text-xs font-medium text-rose-700 hover:underline"
                          disabled={remove.isPending}
                          onClick={() => {
                            const reason = window.prompt(`Remove the ${row.category} expense of ${inr(row.amount)}? Why?`);
                            if (reason?.trim()) remove.mutate({ id: row.id, reason: reason.trim() });
                          }}
                        >
                          Remove
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {remove.error ? <p className="p-4 text-sm text-rose-700">{(remove.error as Error).message}</p> : null}
        </div>
      </div>
    </section>
  );
}

function ExpenseForm({ branchId, onDone }: { branchId: string; onDone: () => void }) {
  const session = requireManagementSession();
  const queryClient = useQueryClient();
  const [date, setDate] = useState(today);
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<Mode>("CASH");
  const [fromDrawer, setFromDrawer] = useState(false);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  // Cash from a drawer: this user's open register at this branch, today.
  const hasDrawer = !!session.registerId && session.branchId === branchId;
  const drawer = mode === "CASH" && hasDrawer && fromDrawer;

  const save = useMutation({
    mutationFn: async () => {
      const res = await api.expenses.create({
        body: {
          branchId,
          date: drawer ? undefined : date,
          category,
          amount: Number(amount),
          mode,
          fromDrawer: drawer,
          reference: reference || undefined,
          note: note || undefined,
        },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 201) throw new Error(apiErrorMessage(res.body, "The expense couldn't be saved."));
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["expenses"] }),
        queryClient.invalidateQueries({ queryKey: ["register-current-cash"] }),
      ]);
      onDone();
    },
  });

  return (
    <form
      className="card grid gap-4 p-5 sm:grid-cols-3"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div>
        <label className="field-label" htmlFor="expense-category">Category</label>
        <input id="expense-category" className="field h-10" list="expense-categories" maxLength={60} value={category} onChange={(e) => setCategory(e.target.value)} required autoFocus />
        <datalist id="expense-categories">
          {EXPENSE_CATEGORIES.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      </div>
      <div>
        <label className="field-label" htmlFor="expense-amount">Amount</label>
        <input id="expense-amount" className="field h-10" type="number" min="0.01" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
      </div>
      <div>
        <label className="field-label" htmlFor="expense-date">Paid on</label>
        <input id="expense-date" className="field h-10" type="date" max={today()} value={drawer ? today() : date} disabled={drawer} onChange={(e) => setDate(e.target.value)} required />
      </div>
      <div>
        <label className="field-label" htmlFor="expense-mode">Paid by</label>
        <select id="expense-mode" className="field h-10" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
          {MODES.map((option) => (
            <option key={option.mode} value={option.mode}>{option.label}</option>
          ))}
        </select>
        {mode === "CASH" && hasDrawer ? (
          <label className="mt-1.5 flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={fromDrawer} onChange={(e) => setFromDrawer(e.target.checked)} />
            From this register's drawer (today)
          </label>
        ) : null}
      </div>
      <div>
        <label className="field-label" htmlFor="expense-reference">Reference (optional)</label>
        <input id="expense-reference" className="field h-10" maxLength={64} placeholder="Bill no., UTR, cheque no." value={reference} onChange={(e) => setReference(e.target.value)} />
      </div>
      <div>
        <label className="field-label" htmlFor="expense-note">Note (optional)</label>
        <input id="expense-note" className="field h-10" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {save.error ? <p className="text-sm text-rose-700 sm:col-span-3">{(save.error as Error).message}</p> : null}
      <div className="flex justify-end gap-2 sm:col-span-3">
        <button className="btn-secondary" type="button" onClick={onDone}>Cancel</button>
        <button className="btn-primary" type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save Expense"}</button>
      </div>
    </form>
  );
}
