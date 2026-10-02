import { money } from "../route-helpers";

/**
 * Who the sale is for (a customer, or a walk-in with an optional name and contact), plus
 * the Payment and Back to Orders buttons.
 */
export function CustomerSection({
  selectedCustomer,
  isWalkInSelected,
  walkInName,
  walkInPhone,
  walletBalance,
  busy,
  onWalkIn,
  onPickCustomer,
  onWalkInNameChange,
  onWalkInPhoneChange,
  onPayment,
  onBack,
}: {
  selectedCustomer: { name: string | null; phone: string | null } | undefined;
  isWalkInSelected: boolean;
  walkInName: string;
  walkInPhone: string;
  walletBalance: number;
  busy: boolean;
  onWalkIn: () => void;
  onPickCustomer: () => void;
  onWalkInNameChange: (value: string) => void;
  onWalkInPhoneChange: (value: string) => void;
  onPayment: () => void;
  onBack: () => void;
}) {
  return (
    <div className="p-2">
      <div className="rounded border border-slate-200 p-2">
        <div className="flex items-center justify-between">
          <label className="text-sm text-slate-600">Customer</label>
          <button
            className="rounded bg-slate-200 px-2 py-1 text-xs font-semibold text-slate-700"
            onClick={onWalkIn}
            title="Reset to walk in customer"
          >
            Walk In
          </button>
        </div>
        <button
          className="mt-1 w-full rounded border border-slate-300 bg-slate-50 px-2 py-2 text-left text-sm font-semibold text-slate-700"
          onClick={onPickCustomer}
        >
          {selectedCustomer
            ? `${selectedCustomer.name} (${selectedCustomer.phone ?? "No phone"})`
            : "Select Customer"}
        </button>
        {isWalkInSelected ? (
          <div className="mt-2 grid grid-cols-1 gap-2">
            <input
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
              placeholder="Walk-in customer name (optional)"
              value={walkInName}
              onChange={(event) => onWalkInNameChange(event.target.value)}
            />
            <input
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
              placeholder="Walk-in contact details (optional)"
              value={walkInPhone}
              onChange={(event) => onWalkInPhoneChange(event.target.value)}
            />
          </div>
        ) : null}
        {!isWalkInSelected ? (
          <p className="mt-1 text-xs text-slate-600">
            Wallet Balance: ₹ {money(walletBalance)}
          </p>
        ) : null}

        <button
          className="mt-2 w-full rounded bg-emerald-600 px-2 py-2 text-xl font-bold text-white disabled:bg-emerald-300"
          onClick={onPayment}
          disabled={busy}
        >
          Payment
        </button>
        <button
          className="mt-2 w-full rounded bg-slate-200 px-2 py-2 text-lg font-bold text-slate-800 disabled:bg-slate-100 disabled:text-slate-400"
          onClick={onBack}
          disabled={busy}
        >
          Back to Orders
        </button>
      </div>
    </div>
  );
}
