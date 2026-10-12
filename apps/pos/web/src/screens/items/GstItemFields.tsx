import {
  defaultSupplyType,
  GST_SUPPLY_TYPE_LABELS,
  GST_SUPPLY_TYPES,
  GST_UQCS,
  hsnProblem,
  suggestUqc,
  supplyTypeProblem,
  type GstSupplyType,
} from "@pos/contracts";

export type GstItemForm = {
  hsnCode: string;
  /** "" while not chosen: the unit name's suggestion is used. */
  uqc: string;
  /** "" while not chosen: follows the tax rate. */
  supplyType: GstSupplyType | "";
};

export const emptyGstItemForm: GstItemForm = { hsnCode: "", uqc: "", supplyType: "" };

/** The supply type to save: the one chosen if it fits the rate, else the rate's default. */
export function effectiveSupplyType(form: GstItemForm, taxRate: number): GstSupplyType {
  return form.supplyType && !supplyTypeProblem(form.supplyType, taxRate) ? form.supplyType : defaultSupplyType(taxRate);
}

/** The GST unit to save: the one chosen, else the unit name's suggestion (or none). */
export function effectiveUqc(form: GstItemForm, uom: string): string | null {
  return form.uqc || suggestUqc(uom);
}

const labelClass = "text-xs font-medium uppercase tracking-wide text-slate-600";

/** HSN/SAC code, GST unit and supply type, for the item create and edit forms. */
export function GstItemFields({
  value,
  onChange,
  taxRate,
  uom,
  hsnMinDigits,
}: {
  value: GstItemForm;
  onChange: (next: GstItemForm) => void;
  taxRate: number;
  uom: string;
  hsnMinDigits: number;
}) {
  const hsn = value.hsnCode.trim();
  const hsnError = hsn ? hsnProblem(hsn, hsnMinDigits) : null;
  const suggested = suggestUqc(uom);
  const supplyType = effectiveSupplyType(value, taxRate);
  // A taxable item has a rate above 0; the other types are all at 0%.
  const supplyOptions = GST_SUPPLY_TYPES.filter((type) => (taxRate > 0) === (type === "TAXABLE"));

  return (
    <>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>HSN / SAC code</span>
        <input
          className="field"
          inputMode="numeric"
          placeholder={`${hsnMinDigits} or more digits`}
          value={value.hsnCode}
          onChange={(e) => onChange({ ...value, hsnCode: e.target.value.replace(/\s/g, "") })}
        />
        {hsnError ? (
          <span className="text-xs text-rose-700">{hsnError}</span>
        ) : !hsn ? (
          <span className="text-xs text-amber-700">Needed for GST returns.</span>
        ) : null}
      </label>

      <label className="flex flex-col gap-1">
        <span className={labelClass}>GST unit (UQC)</span>
        <select
          className="field"
          value={value.uqc}
          onChange={(e) => onChange({ ...value, uqc: e.target.value })}
        >
          <option value="">{suggested ? `${suggested} (from the unit "${uom}")` : "Not set"}</option>
          {GST_UQCS.map((uqc) => (
            <option key={uqc.code} value={uqc.code}>
              {uqc.code} - {uqc.name}
            </option>
          ))}
        </select>
        {!value.uqc && !suggested ? (
          <span className="text-xs text-amber-700">Choose the GST unit for "{uom || "this unit"}".</span>
        ) : null}
      </label>

      <label className="flex flex-col gap-1">
        <span className={labelClass}>GST supply type</span>
        <select
          className="field"
          value={supplyType}
          onChange={(e) => onChange({ ...value, supplyType: e.target.value as GstSupplyType })}
          disabled={supplyOptions.length === 1}
        >
          {supplyOptions.map((type) => (
            <option key={type} value={type}>
              {GST_SUPPLY_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
        {taxRate === 0 ? (
          <span className="text-xs text-slate-500">0% items: nil rated, exempt or outside GST.</span>
        ) : null}
      </label>
    </>
  );
}
