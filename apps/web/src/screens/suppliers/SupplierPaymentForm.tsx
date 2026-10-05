import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { api, apiErrorMessage, authHeaders } from "../../lib/api";
import { getSession } from "../../lib/session";
import { inr } from "../route-helpers";
import { PAYMENT_MODE_LABELS, type Supplier } from "./useSuppliers";

type Mode = keyof typeof PAYMENT_MODE_LABELS;

/** Money paid to a supplier from the branch: in cash from this register's drawer, or otherwise. */
export function SupplierPaymentForm({ supplier, branchId }: { supplier: Supplier; branchId: string }) {
  const queryClient = useQueryClient();
  const session = getSession();
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<Mode>("BANK_TRANSFER");
  const [reference, setReference] = useState("");
  const [fromDrawer, setFromDrawer] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  // Cash comes from a drawer only at the branch where this user's register is open.
  const canUseDrawer = mode === "CASH" && !!session?.registerId && session.branchId === branchId;

  const pay = useMutation({
    mutationFn: async () => {
      const res = await api.suppliers.pay({
        params: { id: supplier.id },
        body: { branchId, amount: Number(amount), mode, fromDrawer: canUseDrawer && fromDrawer, reference: reference.trim() || undefined },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 201) throw new Error(apiErrorMessage(res.body, "Failed to record the payment"));
      return res.body;
    },
    onSuccess: (payment) => {
      setAmount("");
      setReference("");
      setMessage({ ok: true, text: `Paid ${inr(payment.amount)} to ${supplier.name}${payment.registerSessionId ? " from the drawer" : ""}.` });
      void queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      void queryClient.invalidateQueries({ queryKey: ["supplier-account", supplier.id] });
      void queryClient.invalidateQueries({ queryKey: ["register-current-cash"] });
    },
    onError: (e) => setMessage({ ok: false, text: (e as Error).message }),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!(Number(amount) > 0)) return setMessage({ ok: false, text: "Enter the amount paid" });
    pay.mutate();
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        <label className="block text-sm text-slate-600">
          Amount
          <input className="field mt-1" type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="block text-sm text-slate-600">
          Paid by
          <select className="field mt-1" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
            {Object.entries(PAYMENT_MODE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-slate-600">
          Reference <span className="text-slate-400">(cheque no., UTR...)</span>
          <input className="field mt-1" maxLength={64} value={reference} onChange={(e) => setReference(e.target.value)} />
        </label>
      </div>
      {mode === "CASH" ? (
        canUseDrawer ? (
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={fromDrawer} onChange={(e) => setFromDrawer(e.target.checked)} />
            Taken from this register's drawer (the cash expected at close goes down)
          </label>
        ) : (
          <p className="text-xs text-slate-500">Cash paid from outside a register. Open a register at this branch to pay from its drawer.</p>
        )
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" type="submit" disabled={pay.isPending}>
          {pay.isPending ? "Saving..." : "Record Payment"}
        </button>
        {message ? (
          <span className={`text-sm ${message.ok ? "text-emerald-700" : "text-rose-700"}`} role={message.ok ? undefined : "alert"}>
            {message.text}
          </span>
        ) : null}
      </div>
    </form>
  );
}
