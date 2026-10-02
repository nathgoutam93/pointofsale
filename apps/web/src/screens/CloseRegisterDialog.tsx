import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, apiErrorMessage, authHeaders } from "../lib/api";
import { updateSession } from "../lib/session";
import { money } from "./route-helpers";

type ClosedRegister = {
  closingBalance: number | null;
  expectedCash: number | null;
  cashDifference: number | null;
};

function differenceLabel(difference: number) {
  if (Math.abs(difference) < 0.005) return "Balanced";
  return difference > 0 ? `Over by ₹ ${money(difference)}` : `Short by ₹ ${money(-difference)}`;
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
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 text-slate-900 shadow-xl">
        <h2 className="text-lg font-semibold">Close Register</h2>
        {closed ? (
          <>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Expected cash</dt><dd>₹ {money(closed.expectedCash)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Counted</dt><dd>₹ {money(closed.closingBalance)}</dd></div>
              <div className="flex justify-between border-t border-slate-100 pt-2 font-semibold">
                <dt>Difference</dt>
                <dd className={Math.abs(closed.cashDifference ?? 0) < 0.005 ? "text-emerald-600" : "text-rose-600"}>
                  {differenceLabel(closed.cashDifference ?? 0)}
                </dd>
              </div>
            </dl>
            <button
              className="mt-5 w-full rounded-lg bg-slate-900 px-3 py-2 font-semibold text-white"
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
              <div className="flex justify-between"><dt className="text-slate-500">Opening balance</dt><dd>₹ {money(current.data.openingBalance)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Cash taken</dt><dd>+ ₹ {money(current.data.cashSales)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Cash refunded</dt><dd>− ₹ {money(current.data.cashRefunds)}</dd></div>
              <div className="flex justify-between border-t border-slate-100 pt-2 font-semibold"><dt>Expected in drawer</dt><dd>₹ {money(expected)}</dd></div>
            </dl>
            <label className="mt-4 block text-sm text-slate-600">
              Cash counted
              <input
                autoFocus
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-lg"
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
              <button className="flex-1 rounded-lg border border-slate-300 px-3 py-2" onClick={onCancel} disabled={close.isPending}>
                Cancel
              </button>
              <button
                className="flex-1 rounded-lg bg-slate-900 px-3 py-2 font-semibold text-white disabled:opacity-40"
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
