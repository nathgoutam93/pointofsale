import { GST_STATES, gstStateLabel } from "@pos/contracts";
import type { CustomerAccount } from "@pos/contracts";
import { inr } from "../route-helpers";

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
  account,
  branchStateCode,
  placeOfSupply,
  onPlaceOfSupplyChange,
  reference,
  onReferenceChange,
  busy,
  onWalkIn,
  onPickCustomer,
  onWalkInNameChange,
  onWalkInPhoneChange,
  onPayment,
  onBack,
}: {
  selectedCustomer: { name: string | null; phone: string | null; gstin?: string | null } | undefined;
  isWalkInSelected: boolean;
  walkInName: string;
  walkInPhone: string;
  walletBalance: number;
  /** What a registered customer owes already; null for walk-in or while loading. */
  account: CustomerAccount | null;
  /** The branch's state; null hides the place of supply (no state set, or a composition taxpayer). */
  branchStateCode: string | null;
  /** The state goods are shipped to; null for a counter sale. */
  placeOfSupply: string | null;
  onPlaceOfSupplyChange: (stateCode: string | null) => void;
  /** A registered buyer's order or reference number. */
  reference: string;
  onReferenceChange: (value: string) => void;
  busy: boolean;
  onWalkIn: () => void;
  onPickCustomer: () => void;
  onWalkInNameChange: (value: string) => void;
  onWalkInPhoneChange: (value: string) => void;
  onPayment: () => void;
  onBack: () => void;
}) {
  // A registered buyer: their GSTIN goes on the bill. Their state is the GSTIN's first two digits.
  const buyerGstin = !isWalkInSelected ? selectedCustomer?.gstin ?? null : null;
  const buyerState = buyerGstin?.slice(0, 2) ?? null;
  return (
    <div className="space-y-3 p-4">
      <div data-tour="pos-customer">
        <div className="mb-1 flex items-center justify-between">
          <span className="field-label mb-0">Customer</span>
          <button
            className="rounded px-1 text-xs font-semibold text-brand-600 hover:bg-brand-50 hover:text-brand-700"
            onClick={onWalkIn}
            title="Reset to walk in customer"
          >
            Use walk-in
          </button>
        </div>
        <button
          className="field flex items-center justify-between gap-2 text-left font-medium hover:border-slate-400"
          onClick={onPickCustomer}
        >
          <span className="truncate">
            {selectedCustomer
              ? `${selectedCustomer.name} (${selectedCustomer.phone ?? "No phone"})`
              : "Select Customer"}
          </span>
          <span className="shrink-0 text-xs font-semibold text-brand-600">Change</span>
        </button>
        {isWalkInSelected ? (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <input
              className="field"
              placeholder="Name (optional)"
              value={walkInName}
              onChange={(event) => onWalkInNameChange(event.target.value)}
            />
            <input
              className="field"
              placeholder="Phone or email (optional)"
              value={walkInPhone}
              onChange={(event) => onWalkInPhoneChange(event.target.value)}
            />
          </div>
        ) : (
          <div className="mt-1 space-y-0.5 text-xs text-slate-500">
            <p>
              Wallet balance: <span className="font-semibold text-slate-700 tabular-nums">{inr(walletBalance)}</span>
            </p>
            {account && (account.outstanding > 0 || account.creditLimit !== null) ? (
              <p>
                Owes <span className="font-semibold text-amber-700 tabular-nums">{inr(account.outstanding)}</span>
                {account.creditLimit !== null ? (
                  <>
                    {" "}of <span className="tabular-nums">{inr(account.creditLimit)}</span> limit
                  </>
                ) : null}
                {account.overdue > 0 ? (
                  <span className="ml-1.5 badge bg-rose-50 text-rose-700 ring-1 ring-rose-200 ring-inset">{inr(account.overdue)} overdue</span>
                ) : null}
              </p>
            ) : null}
          </div>
        )}
        {buyerGstin ? (
          <div className="mt-2 space-y-2">
            <p className="text-xs text-slate-600">
              <span className="badge bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 ring-inset">Registered buyer</span>{" "}
              GSTIN <span className="font-mono font-semibold text-slate-800">{buyerGstin}</span>: printed on the bill, filed under B2B.
            </p>
            <input
              className="field"
              placeholder="Their order / reference no. (optional)"
              maxLength={40}
              value={reference}
              onChange={(event) => onReferenceChange(event.target.value)}
            />
          </div>
        ) : null}
      </div>
      {branchStateCode ? (
        <div>
          <label className="field-label">Place of supply</label>
          <select
            className="field"
            value={placeOfSupply ?? ""}
            onChange={(event) => onPlaceOfSupplyChange(event.target.value || null)}
          >
            <option value="">Over the counter ({gstStateLabel(branchStateCode)})</option>
            {GST_STATES.filter((state) => state.code !== branchStateCode).map((state) => (
              <option key={state.code} value={state.code}>
                Shipped to {gstStateLabel(state.code)}
              </option>
            ))}
          </select>
          {placeOfSupply ? (
            <p className="mt-1 text-xs text-amber-700">Inter-state sale: IGST applies instead of CGST and SGST.</p>
          ) : null}
          {buyerState && buyerState !== branchStateCode && placeOfSupply !== buyerState ? (
            <p className="mt-1 text-xs text-slate-600">
              The buyer is in {gstStateLabel(buyerState)}. Sold over the counter, CGST and SGST apply; if the goods are
              delivered to them,{" "}
              <button type="button" className="font-semibold text-brand-600 hover:underline" onClick={() => onPlaceOfSupplyChange(buyerState)}>
                ship to {gstStateLabel(buyerState)}
              </button>
              .
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-[auto_1fr] gap-2 pt-1" data-tour="pos-pay">
        <button
          className="btn-secondary h-12 px-4"
          onClick={onBack}
          disabled={busy}
          title="Keep this cart as a held order and go back to the order list"
        >
          Hold
        </button>
        <button className="btn-primary h-12 text-base" onClick={onPayment} disabled={busy}>
          Proceed to Payment
        </button>
      </div>
    </div>
  );
}
