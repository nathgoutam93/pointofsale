import { BuyerFields, buyerProblem, type BuyerDetails } from "../../components/BuyerFields";
import { CreditFields, creditProblem, type CreditDetails } from "../../components/CreditFields";

/** Adding a customer: name, phone, GST and billing details, and (admins) credit. */
export function NewCustomerForm({
  name,
  setName,
  phone,
  setPhone,
  buyer,
  setBuyer,
  isAdmin,
  credit,
  setCredit,
  createCustomer,
}: {
  name: string;
  setName: (name: string) => void;
  phone: string;
  setPhone: (phone: string) => void;
  buyer: BuyerDetails;
  setBuyer: (buyer: BuyerDetails) => void;
  isAdmin: boolean;
  credit: CreditDetails;
  setCredit: (credit: CreditDetails) => void;
  createCustomer: { mutate: () => void; isPending: boolean; isError: boolean; error: Error | null };
}) {
  return (
    <form
      className="mt-3 grid grid-cols-1 gap-2 rounded-md border border-slate-200 bg-slate-50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        createCustomer.mutate();
      }}
    >
      <input
        className="field"
        placeholder="Customer name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <input
        className="field"
        placeholder="Phone (optional)"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />
      <BuyerFields value={buyer} onChange={setBuyer} />
      {isAdmin ? <CreditFields value={credit} onChange={setCredit} /> : null}
      <button
        className="btn-primary"
        disabled={createCustomer.isPending || !name.trim() || !!buyerProblem(buyer) || !!creditProblem(credit)}
        type="submit"
      >
        {createCustomer.isPending ? "Creating..." : "Create Customer"}
      </button>
      {createCustomer.isError ? (
        <p className="text-xs text-rose-700">{(createCustomer.error as Error).message}</p>
      ) : null}
    </form>
  );
}
