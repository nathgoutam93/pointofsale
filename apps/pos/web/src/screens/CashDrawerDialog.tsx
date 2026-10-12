import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CASH_IN_REASONS, CASH_OUT_REASONS, EXPENSE_CATEGORIES } from "@pos/contracts";
import { FormEvent, useState } from "react";
import { api, apiErrorMessage, authHeaders } from "../lib/api";
import { getSession } from "../lib/session";
import { inr } from "./route-helpers";

type Kind = "EXPENSE" | "CASH_OUT" | "CASH_IN";

const KINDS: Array<{ kind: Kind; label: string }> = [
  { kind: "EXPENSE", label: "Pay an expense" },
  { kind: "CASH_OUT", label: "Take cash out" },
  { kind: "CASH_IN", label: "Put cash in" },
];

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/**
 * Cash that moves through the open register's drawer other than sales and refunds: expenses
 * paid from it, cash taken to the bank or the owner, and change put in. Each changes the cash
 * expected at close.
 */
export function CashDrawerDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const session = getSession();
  const [kind, setKind] = useState<Kind>("EXPENSE");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");

  const register = useQuery({
    queryKey: ["register-current-cash"],
    queryFn: async () => {
      const res = await api.registers.current({ extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error("Couldn't load the register");
      return res.body;
    },
  });
  const entries = useQuery({
    queryKey: ["register-cash-entries"],
    queryFn: async () => {
      const res = await api.expenses.registerCashEntries({ extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error("Couldn't load this register's cash entries");
      return res.body;
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const value = Number(amount);
      if (kind === "EXPENSE") {
        const res = await api.expenses.create({
          body: { branchId: session?.branchId ?? "", category: reason, amount: value, mode: "CASH", fromDrawer: true, note: note || undefined },
          extraHeaders: authHeaders(),
        });
        if (res.status !== 201) throw new Error(apiErrorMessage(res.body, "The expense couldn't be saved."));
        return `Expense of ${inr(value)} paid from the drawer.`;
      }
      const res = await api.expenses.cashMovement({ body: { type: kind, amount: value, reason, note: note || undefined }, extraHeaders: authHeaders() });
      if (res.status !== 201) throw new Error(apiErrorMessage(res.body, "That couldn't be saved."));
      return kind === "CASH_IN" ? `${inr(value)} put into the drawer.` : `${inr(value)} taken out of the drawer.`;
    },
    onSuccess: async (text) => {
      setMessage(text);
      setAmount("");
      setReason("");
      setNote("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["register-current-cash"] }),
        queryClient.invalidateQueries({ queryKey: ["register-cash-entries"] }),
        queryClient.invalidateQueries({ queryKey: ["expenses"] }),
      ]);
    },
  });

  const suggestions = kind === "EXPENSE" ? EXPENSE_CATEGORIES : kind === "CASH_IN" ? CASH_IN_REASONS : CASH_OUT_REASONS;
  const rows = [
    ...(entries.data?.expenses ?? []).map((row) => ({ id: row.id, at: row.createdAt, label: `Expense · ${row.category}`, sign: "−", amount: row.amount, by: row.createdByName, note: row.note })),
    ...(entries.data?.movements ?? []).map((row) => ({
      id: row.id,
      at: row.createdAt,
      label: `${row.type === "CASH_IN" ? "Put in" : "Taken out"} · ${row.reason}`,
      sign: row.type === "CASH_IN" ? "+" : "−",
      amount: row.amount,
      by: row.createdByName,
      note: row.note,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="modal-backdrop z-50">
      <div role="dialog" aria-modal="true" aria-labelledby="cash-drawer-title" className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 text-slate-900 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="cash-drawer-title" className="text-lg font-semibold">Cash In / Out</h2>
            {register.data ? (
              <p className="mt-0.5 text-sm text-slate-500">
                {register.data.counterName} · expected in drawer <span className="font-semibold tabular-nums text-slate-900">{inr(register.data.expectedCash)}</span>
              </p>
            ) : null}
          </div>
          <button className="btn-ghost px-2" type="button" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1" role="tablist">
          {KINDS.map((option) => (
            <button
              key={option.kind}
              type="button"
              role="tab"
              aria-selected={kind === option.kind}
              className={`rounded-md px-2 py-1.5 text-xs font-medium ${kind === option.kind ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
              onClick={() => {
                setKind(option.kind);
                setReason("");
                setMessage("");
                save.reset();
              }}
            >
              {option.label}
            </button>
          ))}
        </div>

        <form
          className="mt-4 grid gap-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            setMessage("");
            save.mutate();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label" htmlFor="cash-amount">Amount</label>
              <input id="cash-amount" className="field h-10" type="number" min="0.01" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus />
            </div>
            <div>
              <label className="field-label" htmlFor="cash-reason">{kind === "EXPENSE" ? "Category" : "Reason"}</label>
              <input id="cash-reason" className="field h-10" list="cash-reasons" maxLength={60} value={reason} onChange={(e) => setReason(e.target.value)} required />
              <datalist id="cash-reasons">
                {suggestions.map((suggestion) => (
                  <option key={suggestion} value={suggestion} />
                ))}
              </datalist>
            </div>
          </div>
          <div>
            <label className="field-label" htmlFor="cash-note">Note (optional)</label>
            <input id="cash-note" className="field h-10" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {save.error ? <p className="text-sm text-rose-700">{(save.error as Error).message}</p> : null}
          {message ? <p className="text-sm text-emerald-700" role="status">{message}</p> : null}
          <button className="btn-primary h-10" type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving…" : KINDS.find((option) => option.kind === kind)?.label}
          </button>
        </form>

        <div className="mt-5 border-t border-slate-100 pt-3">
          <p className="eyebrow mb-2">This register</p>
          {rows.length === 0 ? (
            <p className="text-sm text-slate-500">No cash moved in or out yet.</p>
          ) : (
            <ul className="max-h-48 space-y-1.5 overflow-y-auto text-sm">
              {rows.map((row) => (
                <li key={row.id} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">
                    <span className="text-slate-500">{time(row.at)}</span> {row.label}
                    {row.note ? <span className="text-slate-500"> · {row.note}</span> : null}
                  </span>
                  <span className="shrink-0 tabular-nums">{row.sign} {inr(row.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
