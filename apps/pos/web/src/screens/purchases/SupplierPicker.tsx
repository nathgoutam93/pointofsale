import { useSuppliers } from "../suppliers/useSuppliers";

/** The supplier chosen for a purchase: one of the list, or a new one by name (added when the purchase is saved). */
export type SupplierChoice = { supplierId: string; newName: string; newGstin: string };
export const NEW_SUPPLIER = "new";
export const emptySupplierChoice: SupplierChoice = { supplierId: "", newName: "", newGstin: "" };

/** The GSTIN a purchase from this choice is made under (GST is charged only with one). */
export function useChosenGstin(choice: SupplierChoice) {
  const suppliers = useSuppliers();
  if (choice.supplierId === NEW_SUPPLIER) return choice.newGstin.trim().toUpperCase();
  return suppliers.data?.find((supplier) => supplier.id === choice.supplierId)?.gstin ?? "";
}

export function SupplierPicker({ value, onChange }: { value: SupplierChoice; onChange: (next: SupplierChoice) => void }) {
  const suppliers = useSuppliers();
  const chosen = suppliers.data?.find((supplier) => supplier.id === value.supplierId);
  return (
    <>
      <label className="block text-sm text-slate-600">
        Supplier
        <select className="field mt-1" value={value.supplierId} onChange={(e) => onChange({ ...value, supplierId: e.target.value })} required>
          <option value="">Choose a supplier</option>
          {(suppliers.data ?? []).map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
          <option value={NEW_SUPPLIER}>+ New supplier</option>
        </select>
      </label>
      {value.supplierId === NEW_SUPPLIER ? (
        <>
          <label className="block text-sm text-slate-600">
            New supplier's name
            <input className="field mt-1" value={value.newName} maxLength={120} onChange={(e) => onChange({ ...value, newName: e.target.value })} required />
          </label>
          <label className="block text-sm text-slate-600">
            Their GSTIN <span className="text-slate-400">(optional)</span>
            <input className="field mt-1 uppercase" value={value.newGstin} maxLength={15} onChange={(e) => onChange({ ...value, newGstin: e.target.value })} />
          </label>
        </>
      ) : chosen ? (
        <p className="self-end pb-2 text-xs text-slate-500">
          {chosen.gstin ? `GSTIN ${chosen.gstin}` : "No GSTIN: charges no GST"}
          {chosen.paymentTermsDays !== null ? ` · due in ${chosen.paymentTermsDays} days` : " · due at once"}
        </p>
      ) : null}
    </>
  );
}
