import { useEffect, useRef } from "react";
import { inr, money } from "../route-helpers";
import { keypadKeyFromEvent, shouldIgnoreDialogKey } from "./keyboard";
import type { Payment } from "./usePayment";

/**
 * Takes payment for the sale. Enter adds the typed amount, Ctrl/Cmd+Enter validates,
 * Escape goes back and typed digits go to the keypad.
 */
export function PaymentModal({
  payment,
  total,
  isWalkInSelected,
  walletBalance,
  checkoutPending,
  onValidate,
}: {
  payment: Payment;
  total: number;
  isWalkInSelected: boolean;
  walletBalance: number;
  checkoutPending: boolean;
  onValidate: () => void;
}) {
  const latestRef = useRef({ payment, checkoutPending, onValidate });
  latestRef.current = { payment, checkoutPending, onValidate };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreDialogKey(event)) return;
      const { payment: current, checkoutPending: pending, onValidate: validate } = latestRef.current;

      if (event.key === "Enter") {
        event.preventDefault();
        if (event.ctrlKey || event.metaKey) {
          if (!pending && !current.walletOverused && current.canValidate) {
            validate();
          }
          return;
        }
        current.applyLine();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        current.close();
        return;
      }

      const keypadKey = keypadKeyFromEvent(event);
      if (!keypadKey) return;
      event.preventDefault();
      current.press(keypadKey);
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="modal-backdrop">
      <div className="grid max-h-[calc(100vh-2rem)] w-full max-w-6xl grid-cols-1 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-2xl md:grid-cols-2">
        <div className="flex flex-col bg-slate-50 p-6">
          <div className="flex-1">
            <div className="text-center">
              <p className="eyebrow">{payment.method}</p>
              <p className="mt-2 text-5xl font-semibold tracking-tight text-slate-900 tabular-nums">
                {inr(payment.amount)}
              </p>
              {payment.method === "WALLET" && !isWalkInSelected ? (
                <p className="mt-2 text-sm text-slate-600">
                  Wallet Balance: {inr(walletBalance)}
                </p>
              ) : null}
            </div>

            <div className="mt-8 space-y-2">
              {payment.lines.length === 0 ? (
                <p className="rounded-md border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
                  {payment.method === "CREDIT"
                    ? "Full amount will remain due on customer credit."
                    : "No payments added yet. Choose a method, enter an amount and press Add."}
                </p>
              ) : null}

              {payment.lines.map((line) => (
                <div
                  key={line.mode}
                  className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-3 shadow-xs"
                >
                  <p className="text-sm font-semibold text-slate-800">
                    {line.mode === "WALLET"
                      ? "Customer Account"
                      : line.mode}
                  </p>
                  <div className="flex items-center gap-3">
                    <p className="text-base font-semibold text-slate-900 tabular-nums">
                      {inr(line.amount)}
                    </p>
                    <button
                      className="grid h-7 w-7 place-items-center rounded-md text-lg leading-none text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      onClick={() => payment.removeLine(line.mode)}
                      title="Remove payment line"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 border-t border-slate-200 pt-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-600">Remaining</p>
              <p className="text-2xl font-semibold text-slate-900 tabular-nums">{inr(payment.remainingAmount)}</p>
            </div>
          </div>

          <button
            className="btn-primary mt-4 h-12 w-full text-base"
            onClick={onValidate}
            disabled={
              checkoutPending || payment.walletOverused || !payment.canValidate
            }
          >
            Validate
          </button>

          {payment.walletOverused ? (
            <p className="mt-2 text-sm text-rose-700">
              Wallet payment exceeds available balance.
            </p>
          ) : null}

          {!payment.walletOverused &&
          isWalkInSelected &&
          payment.lines.length > 0 &&
          !payment.matchesTotal ? (
            <p className="mt-2 text-sm text-rose-700">
              Walk-in payment must be exactly {inr(total)}. Current:{" "}
              {inr(payment.totalPaid)}.
            </p>
          ) : null}
          {!payment.walletOverused &&
          !isWalkInSelected &&
          payment.lines.length > 0 &&
          payment.totalPaid < total ? (
            <p className="mt-2 text-sm text-amber-700">
              Partial payment selected. Remaining due:{" "}
              {inr(total - payment.totalPaid)}.
            </p>
          ) : null}
          {!payment.walletOverused &&
          !isWalkInSelected &&
          payment.lines.length > 0 &&
          payment.excessAmount > 0 ? (
            <p className="mt-2 text-sm text-emerald-700">
              Excess {inr(payment.excessAmount)} will be deposited to customer
              wallet.
            </p>
          ) : null}
          {payment.error ? (
            <p className="mt-2 text-sm text-rose-700">
              {payment.error}
            </p>
          ) : null}
        </div>

        <div className="border-t border-slate-200 p-6 md:border-t-0 md:border-l">
          <div className="mb-4 grid grid-cols-2 gap-2">
            {payment.availableMethods.map((method) => (
              <button
                key={method.key}
                className={`rounded-md border px-3 py-3 text-left text-sm font-semibold transition-colors ${payment.method === method.key ? "border-brand-600 bg-brand-50 text-brand-700 ring-1 ring-brand-600" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
                onClick={() => payment.setMethod(method.key)}
              >
                {method.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-4 gap-2">
            {[
              "1",
              "2",
              "3",
              "+10",
              "4",
              "5",
              "6",
              "+20",
              "7",
              "8",
              "9",
              "+50",
              "+/-",
              "0",
              ".",
              "<",
            ].map((key) => (
              <button
                key={key}
                className={`h-14 rounded-md border text-xl font-semibold tabular-nums transition-colors active:scale-[0.97] ${/^\+\d+$/.test(key) ? "border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100" : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50"}`}
                onClick={() => payment.press(key)}
              >
                {key}
              </button>
            ))}

            <button
              className="btn-primary col-span-3 h-14 text-base"
              onClick={payment.applyLine}
              disabled={payment.method === "CREDIT"}
            >
              {payment.method === "CREDIT"
                ? "Credit Selected"
                : `Add / Update ${payment.method}`}
            </button>
            <button
              className="btn-danger col-span-1 h-14 text-base"
              onClick={() => payment.press("C")}
            >
              Clear
            </button>

            <button
              className="btn-secondary col-span-4 h-12 text-base"
              onClick={payment.close}
            >
              Back
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
