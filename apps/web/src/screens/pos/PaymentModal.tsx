import { useEffect, useRef } from "react";
import { money } from "../route-helpers";
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
    <div className="fixed inset-0 z-40 grid place-items-center bg-slate-900/40 p-4">
      <div className="grid w-full max-w-6xl grid-cols-2 overflow-hidden rounded-xl border border-slate-300 bg-white shadow-2xl">
        <div className="flex flex-col bg-slate-50 p-3">
          <div className="flex-1">
            <div className="text-center">
              <p className="text-3xl text-slate-500">{payment.method}</p>
              <p className="mt-3 text-7xl leading-none text-slate-900">
                ${money(payment.amount)}
              </p>
              {payment.method === "WALLET" && !isWalkInSelected ? (
                <p className="mt-4 text-2xl text-slate-600">
                  Wallet Balance: ₹ {money(walletBalance)}
                </p>
              ) : null}
            </div>

            <div className="mx-auto mt-10 max-w-3xl space-y-3">
              {payment.lines.length === 0 ? (
                <p className="text-center text-lg text-slate-500">
                  {payment.method === "CREDIT"
                    ? "Full amount will remain due on customer credit."
                    : "No payment lines yet. Add a payment mode from the left."}
                </p>
              ) : null}

              {payment.lines.map((line) => (
                <div
                  key={line.mode}
                  className="flex items-center justify-between rounded-lg border border-cyan-200 bg-cyan-50 px-5 py-4"
                >
                  <p className="text-4xl text-slate-800">
                    {line.mode === "WALLET"
                      ? "Customer Account"
                      : line.mode}
                  </p>
                  <div className="flex items-center gap-6">
                    <p className="text-4xl text-slate-700">
                      $ {money(line.amount)}
                    </p>
                    <button
                      className="text-4xl font-bold text-rose-600"
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

          <div className="mt-8 border-t border-slate-200 pt-5">
            <div className="flex items-center justify-between text-3xl">
              <p className="text-emerald-600">Remaining</p>
              <p className="text-emerald-500">$ {money(payment.remainingAmount)}</p>
            </div>
          </div>

          <button
            className="mt-2 w-full rounded bg-emerald-600 px-3 py-4 text-2xl font-bold text-white disabled:bg-emerald-300"
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
              Walk-in payment must be exactly ₹ {money(total)}. Current: ₹{" "}
              {money(payment.totalPaid)}.
            </p>
          ) : null}
          {!payment.walletOverused &&
          !isWalkInSelected &&
          payment.lines.length > 0 &&
          payment.totalPaid < total ? (
            <p className="mt-2 text-sm text-amber-700">
              Partial payment selected. Remaining due: ₹{" "}
              {money(total - payment.totalPaid)}.
            </p>
          ) : null}
          {!payment.walletOverused &&
          !isWalkInSelected &&
          payment.lines.length > 0 &&
          payment.excessAmount > 0 ? (
            <p className="mt-2 text-sm text-emerald-700">
              Excess ₹ {money(payment.excessAmount)} will be deposited to customer
              wallet.
            </p>
          ) : null}
          {payment.error ? (
            <p className="mt-2 text-sm text-rose-700">
              {payment.error}
            </p>
          ) : null}
        </div>

        <div className="border-r border-slate-200 p-3">
          <div className="mb-3 grid grid-cols-2 gap-2">
            {payment.availableMethods.map((method) => (
              <button
                key={method.key}
                className={`rounded px-3 py-4 text-left text-2xl ${payment.method === method.key ? "bg-indigo-100 text-indigo-900" : "bg-slate-100 text-slate-700"}`}
                onClick={() => payment.setMethod(method.key)}
              >
                {method.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-4 gap-1">
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
                className={`rounded px-2 py-4 text-2xl font-semibold ${key.startsWith("+") && key.length > 1 ? "bg-emerald-200 text-emerald-900" : "bg-slate-100 text-slate-800"}`}
                onClick={() => payment.press(key)}
              >
                {key}
              </button>
            ))}

            <button
              className="col-span-3 rounded bg-indigo-600 px-2 py-4 text-xl font-bold text-white disabled:bg-indigo-300"
              onClick={payment.applyLine}
              disabled={payment.method === "CREDIT"}
            >
              {payment.method === "CREDIT"
                ? "Credit Selected"
                : `Add / Update ${payment.method}`}
            </button>
            <button
              className="col-span-1 rounded bg-rose-200 px-2 py-4 text-2xl font-semibold text-rose-800"
              onClick={() => payment.press("C")}
            >
              Clear
            </button>

            <button
              className="col-span-4 rounded bg-slate-200 px-2 py-4 text-2xl font-semibold text-slate-800"
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
