import type { Customer } from "./types";

/** Money taken at the counter as wallet credit for the selected customer. */
export function WalletTopupForm({
  selectedCustomer,
  canTakeTopup,
  walletTopupMode,
  setWalletTopupMode,
  walletTopupAmount,
  setWalletTopupAmount,
  addWalletCredit,
}: {
  selectedCustomer: Customer;
  canTakeTopup: boolean;
  walletTopupMode: "CASH" | "CARD" | "UPI";
  setWalletTopupMode: (mode: "CASH" | "CARD" | "UPI") => void;
  walletTopupAmount: string;
  setWalletTopupAmount: (amount: string) => void;
  addWalletCredit: {
    mutate: (variables: { customerId: string; amount: number; mode: "CASH" | "CARD" | "UPI" }) => void;
    isPending: boolean;
    isError: boolean;
    error: Error | null;
  };
}) {
  return (
    <form
      className="card max-w-md p-5 print:hidden"
      data-tour="customers-wallet"
      onSubmit={(e) => {
        e.preventDefault();
        if (!selectedCustomer) return;
        addWalletCredit.mutate({
          customerId: selectedCustomer.id,
          amount: Number(walletTopupAmount),
          mode: walletTopupMode,
        });
      }}
    >
      <h3 className="text-sm font-semibold text-slate-900">Add wallet credit</h3>
      <p className="mt-0.5 text-xs text-slate-500">
        Money taken now, on your open register. Credit can be used as a payment method at checkout.
      </p>
      {!canTakeTopup ? (
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Open a register at this branch to take a top-up.
        </p>
      ) : null}
      <div className="mt-3 flex gap-2">
        <select
          className="field w-28 shrink-0"
          value={walletTopupMode}
          onChange={(e) => setWalletTopupMode(e.target.value as "CASH" | "CARD" | "UPI")}
          aria-label="Paid by"
        >
          <option value="CASH">Cash</option>
          <option value="CARD">Card</option>
          <option value="UPI">UPI</option>
        </select>
        <input
          className="field"
          inputMode="decimal"
          min="0"
          placeholder="Amount"
          value={walletTopupAmount}
          onChange={(e) => setWalletTopupAmount(e.target.value)}
        />
        <button
          className="btn-primary shrink-0"
          disabled={
            !canTakeTopup ||
            addWalletCredit.isPending ||
            !walletTopupAmount.trim() ||
            !Number.isFinite(Number(walletTopupAmount)) ||
            Number(walletTopupAmount) <= 0
          }
          type="submit"
        >
          {addWalletCredit.isPending ? "Adding..." : "Add Credit"}
        </button>
      </div>
      {addWalletCredit.isError ? (
        <p className="mt-2 text-xs text-rose-700">
          {(addWalletCredit.error as Error).message}
        </p>
      ) : null}
    </form>
  );
}
