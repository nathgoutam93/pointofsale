import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, apiErrorMessage, authHeaders } from "../lib/api";
import { updateSession } from "../lib/session";
import { inr } from "./route-helpers";

type ClosedRegister = {
  closingBalance: number | null;
  expectedCash: number | null;
  cashDifference: number | null;
};

function differenceLabel(difference: number) {
  if (Math.abs(difference) < 0.005) return "Balanced";
  return difference > 0 ? `Over by ${inr(difference)}` : `Short by ${inr(-difference)}`;
}

/**
 * Close the register by counting the drawer: shows what should be there (opening balance
 * + cash taken − cash refunded), the difference as the cashier types the count, and the
 * saved result before leaving.
 */
export function CloseRegisterDialog({ onCancel }: { onCancel: () => void }) {
  const [counted, setCounted] = useState("");
  const [closed, setClosed] = useState<ClosedRegister | null>(null);

  const current = useQuery({
    queryKey: ["register-current-cash"],
    queryFn: async () => {
      const res = await api.registers.current({ extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error("Failed to load the register");
      return res.body;
    },
  });

  const close = useMutation({
    mutationFn: async (closingBalance: number) => {
      const res = await api.registers.close({ body: { closingBalance }, extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "Failed to close register"));
      return res.body;
    },
    onSuccess: (data) => {
      updateSession({ token: data.token, branchId: null, registerId: null });
      setClosed(data.register);
    },
  });

  const countedAmount = Number(counted);
  const countedValid = counted.trim() !== "" && Number.isFinite(countedAmount) && countedAmount >= 0;
  const expected = current.data?.expectedCash ?? 0;
  const liveDifference = countedValid ? Math.round((countedAmount - expected) * 100) / 100 : null;

  return (
    <div className="modal-backdrop z-50">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 text-slate-900 shadow-2xl">
        <h2 className="text-lg font-semibold">Close Register</h2>
        {closed ? (
          <>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Expected cash</dt><dd className="tabular-nums">{inr(closed.expectedCash)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Counted</dt><dd className="tabular-nums">{inr(closed.closingBalance)}</dd></div>
              <div className="flex justify-between border-t border-slate-100 pt-2 font-semibold">
                <dt>Difference</dt>
                <dd className={Math.abs(closed.cashDifference ?? 0) < 0.005 ? "text-emerald-600" : "text-rose-600"}>
                  {differenceLabel(closed.cashDifference ?? 0)}
                </dd>
              </div>
            </dl>
            <button
              className="btn-primary mt-5 w-full"
              onClick={() => {
                window.location.href = "/open-register";
              }}
            >
              Done
            </button>
          </>
        ) : current.isLoading ? (
          <p className="mt-4 text-sm text-slate-500">Loading…</p>
        ) : current.error || !current.data ? (
          <p className="mt-4 text-sm text-rose-600">Couldn't load this register. Close the menu and try again.</p>
        ) : (
          <>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Opening balance</dt><dd className="tabular-nums">{inr(current.data.openingBalance)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Cash taken</dt><dd className="tabular-nums">+ {inr(current.data.cashSales)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Cash refunded</dt><dd className="tabular-nums">− {inr(current.data.cashRefunds)}</dd></div>
              <div className="flex justify-between border-t border-slate-100 pt-2 font-semibold"><dt>Expected in drawer</dt><dd className="tabular-nums">{inr(expected)}</dd></div>
            </dl>
            <label className="mt-4 block text-sm text-slate-600">
              Cash counted
              <input
                autoFocus
                className="field mt-1 text-lg"
                inputMode="decimal"
                placeholder="0.00"
                value={counted}
                onChange={(e) => setCounted(e.target.value)}
              />
            </label>
            {liveDifference !== null ? (
              <p className={`mt-2 text-sm font-semibold ${Math.abs(liveDifference) < 0.005 ? "text-emerald-600" : "text-rose-600"}`}>
                {differenceLabel(liveDifference)}
              </p>
            ) : null}
            {close.error ? <p className="mt-2 text-sm text-rose-600">{(close.error as Error).message}</p> : null}
            <div className="mt-5 flex gap-2">
              <button className="btn-secondary flex-1" onClick={onCancel} disabled={close.isPending}>
                Cancel
              </button>
              <button
                className="btn-primary flex-1"
                disabled={!countedValid || close.isPending}
                onClick={() => close.mutate(countedAmount)}
              >
                {close.isPending ? "Closing…" : "Close Register"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
