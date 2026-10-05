import { inr } from "../route-helpers";
import type { CurrentInvoice, PaymentMode } from "./types";
import type { SettlePayment } from "./useSettlePayment";

/**
 * Takes payment on what is still owed on the bill: payment lines by method, entered on the
 * keypad, then Validate. The keyboard is handled by useSettlePaymentKeys.
 */
export function SettleModal({
  payment,
  isRegisteredCustomer,
  pendingAmount,
  currentInvoice,
  settleInvoice,
}: {
  payment: SettlePayment;
  isRegisteredCustomer: boolean;
  /** What is still owed on the bill. */
  pendingAmount: number;
  currentInvoice: CurrentInvoice | null;
  settleInvoice: {
    isPending: boolean;
    mutate: (payload: { invoiceId: string; payments: Array<{ mode: PaymentMode; amount: number }> }) => void;
  };
}) {
  const {
    paymentMethod,
    setPaymentMethod,
    paymentAmount,
    paymentLines,
    paymentModalError,
    setPaymentModalOpen,
    setPaymentModalError,
    customerWallet,
    availablePaymentMethods,
    totalPaid,
    remainingAmount,
    paymentCanSubmit,
    walletBalance,
    walletOverused,
    paymentKeypadPress,
    applyPaymentLine,
    removePaymentLine,
  } = payment;

  return (
    <div className="modal-backdrop">
      <div className="grid max-h-[calc(100vh-2rem)] w-full max-w-6xl grid-cols-1 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-2xl md:grid-cols-2">
        <div className="flex flex-col bg-slate-50 p-6">
          <div className="flex-1">
            <div className="text-center">
              <p className="eyebrow">{paymentMethod}</p>
              <p className="mt-2 text-5xl font-semibold tracking-tight text-slate-900 tabular-nums">
                {inr(paymentAmount)}
              </p>
              {paymentMethod === "WALLET" ? (
                <p
                  className={`mt-2 text-sm ${isRegisteredCustomer && !customerWallet.isError ? "text-slate-600" : "text-rose-700"}`}
                >
                  {!isRegisteredCustomer
                    ? "Wallet not available for walk-in customer."
                    : customerWallet.isLoading
                      ? "Loading wallet balance..."
                      : customerWallet.isError
                        ? "Failed to load wallet balance."
                        : `Wallet Balance: ${inr(walletBalance)}`}
                </p>
              ) : null}
            </div>

            <div className="mt-8 space-y-2">
              {paymentLines.length === 0 ? (
                <p className="rounded-md border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
                  No payments added yet. Choose a method, enter an amount and press Add.
                </p>
              ) : null}

              {paymentLines.map((line) => (
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
                      onClick={() => removePaymentLine(line.mode)}
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
              <p className="text-2xl font-semibold text-slate-900 tabular-nums">{inr(remainingAmount)}</p>
            </div>
          </div>

          <button
            className="btn-primary mt-4 h-12 w-full text-base"
            onClick={() => {
              if (!currentInvoice) return;
              settleInvoice.mutate({
                invoiceId: currentInvoice.id,
                payments: paymentLines,
              });
            }}
            disabled={
              settleInvoice.isPending ||
              walletOverused ||
              !currentInvoice ||
              paymentLines.length === 0 ||
              !paymentCanSubmit
            }
          >
            Validate
          </button>

          {walletOverused ? (
            <p className="mt-2 text-sm text-rose-700">
              Wallet payment exceeds available balance.
            </p>
          ) : null}
          {paymentLines.length > 0 && totalPaid > pendingAmount + 0.005 ? (
            <p className="mt-2 text-sm text-rose-700">
              Payment total cannot exceed {inr(pendingAmount)}.
              Current: {inr(totalPaid)}.
            </p>
          ) : null}
          {paymentModalError ? (
            <p className="mt-2 text-sm text-rose-700">
              {paymentModalError}
            </p>
          ) : null}
        </div>

        <div className="border-t border-slate-200 p-6 md:border-t-0 md:border-l">
          <div className="mb-4 grid grid-cols-2 gap-2">
            {availablePaymentMethods.map((method) => (
              <button
                key={method.key}
                className={`rounded-md border px-3 py-3 text-left text-sm font-semibold transition-colors ${paymentMethod === method.key ? "border-brand-600 bg-brand-50 text-brand-700 ring-1 ring-brand-600" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
                onClick={() => setPaymentMethod(method.key)}
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
                onClick={() => paymentKeypadPress(key)}
              >
                {key}
              </button>
            ))}

            <button
              className="btn-primary col-span-3 h-14 text-base"
              onClick={applyPaymentLine}
            >
              Add / Update {paymentMethod}
            </button>
            <button
              className="btn-danger col-span-1 h-14 text-base"
              onClick={() => paymentKeypadPress("C")}
            >
              Clear
            </button>

            <button
              className="btn-secondary col-span-4 h-12 text-base"
              onClick={() => {
                setPaymentModalOpen(false);
                setPaymentModalError("");
              }}
            >
              Back
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
