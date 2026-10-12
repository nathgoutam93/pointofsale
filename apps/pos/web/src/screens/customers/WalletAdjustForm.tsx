import type { Customer } from "./types";

/** Admins: correcting the selected customer's wallet balance, with the reason. */
export function WalletAdjustForm({
  selectedCustomer,
  walletAdjustAmount,
  setWalletAdjustAmount,
  walletAdjustReason,
  setWalletAdjustReason,
  adjustWallet,
}: {
  selectedCustomer: Customer;
  walletAdjustAmount: string;
  setWalletAdjustAmount: (amount: string) => void;
  walletAdjustReason: string;
  setWalletAdjustReason: (reason: string) => void;
  adjustWallet: {
    mutate: (variables: { customerId: string; amount: number; reason: string }) => void;
    isPending: boolean;
    isError: boolean;
    error: Error | null;
  };
}) {
  return (
    <form
      className="card max-w-md p-5 print:hidden"
      onSubmit={(e) => {
        e.preventDefault();
        if (!selectedCustomer) return;
        adjustWallet.mutate({
          customerId: selectedCustomer.id,
          amount: Number(walletAdjustAmount),
          reason: walletAdjustReason.trim(),
        });
      }}
    >
      <h3 className="text-sm font-semibold text-slate-900">Correct wallet balance</h3>
      <p className="mt-0.5 text-xs text-slate-500">
        Admins only. No money changes hands: use a negative amount to take credit off.
      </p>
      <div className="mt-3 grid gap-2">
        <input
          className="field"
          inputMode="decimal"
          placeholder="Amount, e.g. 50 or -50"
          value={walletAdjustAmount}
          onChange={(e) => setWalletAdjustAmount(e.target.value)}
        />
        <input
          className="field"
          placeholder="Reason"
          maxLength={200}
          value={walletAdjustReason}
          onChange={(e) => setWalletAdjustReason(e.target.value)}
        />
        <button
          className="btn-secondary"
          disabled={
            adjustWallet.isPending ||
            !Number.isFinite(Number(walletAdjustAmount)) ||
            Number(walletAdjustAmount) === 0 ||
            walletAdjustReason.trim().length < 3
          }
          type="submit"
        >
          {adjustWallet.isPending ? "Saving..." : "Correct balance"}
        </button>
      </div>
      {adjustWallet.isError ? (
        <p className="mt-2 text-xs text-rose-700">{(adjustWallet.error as Error).message}</p>
      ) : null}
    </form>
  );
}
