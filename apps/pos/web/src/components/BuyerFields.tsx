import { gstinProblem, gstStateLabel } from "@pos/contracts";

/** A customer's registered-buyer details, as the Customers screen edits them. */
export type BuyerDetails = { gstin: string; address: string; email: string };

export const emptyBuyer: BuyerDetails = { gstin: "", address: "", email: "" };

export function buyerFrom(customer: { gstin?: string | null; address?: string | null; email?: string | null }): BuyerDetails {
  return { gstin: customer.gstin ?? "", address: customer.address ?? "", email: customer.email ?? "" };
}

/** For the API: trimmed, with empty values as null (which clears them). */
export function buyerBody(buyer: BuyerDetails) {
  const gstin = buyer.gstin.trim().toUpperCase();
  return { gstin: gstin || null, address: buyer.address.trim() || null, email: buyer.email.trim() || null };
}

/** Why the GSTIN typed can't be saved, or null. */
export function buyerProblem(buyer: BuyerDetails) {
  const gstin = buyer.gstin.trim().toUpperCase();
  return gstin ? gstinProblem(gstin) : null;
}

/**
 * GSTIN, billing address and email. A customer with a GSTIN is a registered buyer: their bills
 * carry it, with the address, and go in GSTR-1's B2B section.
 */
export function BuyerFields({ value, onChange }: { value: BuyerDetails; onChange: (next: BuyerDetails) => void }) {
  const gstin = value.gstin.trim().toUpperCase();
  const problem = buyerProblem(value);
  return (
    <div className="grid gap-2">
      <div>
        <input
          className="field font-mono uppercase"
          placeholder="GSTIN (registered businesses)"
          maxLength={15}
          value={value.gstin}
          onChange={(event) => onChange({ ...value, gstin: event.target.value })}
        />
        {problem ? (
          <p className="mt-1 text-xs text-rose-700">{problem}</p>
        ) : gstin ? (
          <p className="mt-1 text-xs text-emerald-700">Registered in {gstStateLabel(gstin.slice(0, 2))}; bills go in GSTR-1 B2B.</p>
        ) : null}
      </div>
      <textarea
        className="field min-h-16"
        placeholder={gstin ? "Billing address (printed on their tax invoice)" : "Address (optional)"}
        rows={2}
        maxLength={300}
        value={value.address}
        onChange={(event) => onChange({ ...value, address: event.target.value })}
      />
      <input
        className="field"
        type="email"
        placeholder="Email (offered when emailing a receipt)"
        value={value.email}
        onChange={(event) => onChange({ ...value, email: event.target.value })}
      />
    </div>
  );
}
