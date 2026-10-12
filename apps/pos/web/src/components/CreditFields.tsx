/** A customer's credit, as the Customers screen edits it (admins only). Empty means none. */
export type CreditDetails = { creditLimit: string; paymentTermsDays: string };

export const emptyCredit: CreditDetails = { creditLimit: "", paymentTermsDays: "" };

export function creditFrom(customer: { creditLimit?: number | null; paymentTermsDays?: number | null }): CreditDetails {
  return {
    creditLimit: customer.creditLimit === null || customer.creditLimit === undefined ? "" : String(customer.creditLimit),
    paymentTermsDays: customer.paymentTermsDays === null || customer.paymentTermsDays === undefined ? "" : String(customer.paymentTermsDays),
  };
}

/** For the API: numbers, with empty values as null (which clears them). */
export function creditBody(credit: CreditDetails) {
  const limit = credit.creditLimit.trim();
  const days = credit.paymentTermsDays.trim();
  return { creditLimit: limit ? Number(limit) : null, paymentTermsDays: days ? Number(days) : null };
}

/** Why what was typed can't be saved, or null. */
export function creditProblem(credit: CreditDetails) {
  const { creditLimit, paymentTermsDays } = creditBody(credit);
  if (creditLimit !== null && (!Number.isFinite(creditLimit) || creditLimit < 0)) return "The credit limit must be an amount of 0 or more.";
  if (paymentTermsDays !== null && (!Number.isInteger(paymentTermsDays) || paymentTermsDays < 0 || paymentTermsDays > 365))
    return "Payment terms are whole days, 0 to 365.";
  return null;
}

/**
 * The most a customer may owe on credit, and the days they have to pay a credit bill. Cashiers
 * can't make a credit sale that takes them past the limit; admins can.
 */
export function CreditFields({ value, onChange }: { value: CreditDetails; onChange: (next: CreditDetails) => void }) {
  const problem = creditProblem(value);
  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <input
          className="field"
          inputMode="decimal"
          placeholder="Credit limit (none)"
          aria-label="Credit limit"
          value={value.creditLimit}
          onChange={(event) => onChange({ ...value, creditLimit: event.target.value })}
        />
        <input
          className="field"
          inputMode="numeric"
          placeholder="Pay within … days"
          aria-label="Payment terms in days"
          value={value.paymentTermsDays}
          onChange={(event) => onChange({ ...value, paymentTermsDays: event.target.value })}
        />
      </div>
      {problem ? (
        <p className="mt-1 text-xs text-rose-700">{problem}</p>
      ) : (
        <p className="mt-1 text-xs text-slate-500">
          Cashiers can't sell on credit past the limit. With terms, a credit bill is overdue that many days after the sale.
        </p>
      )}
    </div>
  );
}
