import type { Dispatch, SetStateAction } from "react";
import type { ItemFormState, SaleUomFormState } from "./itemForm";

/** The item's barcodes besides its code, each optionally for one of its sale units. */
export function BarcodeEditor({
  form,
  saleUomRows,
  barcodeRows,
  setBarcodeRows,
}: {
  form: ItemFormState;
  saleUomRows: SaleUomFormState[];
  barcodeRows: Array<{ barcode: string; saleUom: string }>;
  setBarcodeRows: Dispatch<SetStateAction<Array<{ barcode: string; saleUom: string }>>>;
}) {
  return (
    <div className="md:col-span-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-slate-600">Barcodes</p>
          <p className="text-xs text-slate-500">
            Scanned besides the item code: every EAN on the product, and a box's own barcode.
          </p>
        </div>
        <button
          className="btn-secondary text-xs"
          type="button"
          onClick={() => setBarcodeRows((rows) => [...rows, { barcode: "", saleUom: "" }])}
        >
          Add barcode
        </button>
      </div>
      {barcodeRows.length === 0 ? (
        <p className="text-sm text-slate-500">Only the item code.</p>
      ) : (
        <div className="space-y-2">
          {barcodeRows.map((row, index) => (
            <div key={index} className="grid grid-cols-[1fr_auto_auto] gap-2">
              <input
                className="field"
                placeholder="Scan or type the barcode"
                value={row.barcode}
                onChange={(e) =>
                  setBarcodeRows((rows) => rows.map((entry, i) => (i === index ? { ...entry, barcode: e.target.value } : entry)))
                }
              />
              <select
                className="field w-32"
                value={row.saleUom}
                aria-label="Sells"
                onChange={(e) =>
                  setBarcodeRows((rows) => rows.map((entry, i) => (i === index ? { ...entry, saleUom: e.target.value } : entry)))
                }
              >
                <option value="">{form.uom || "Base unit"}</option>
                {saleUomRows
                  .filter((unit) => unit.uom.trim())
                  .map((unit) => (
                    <option key={unit.uom} value={unit.uom.trim()}>
                      {unit.uom.trim()}
                    </option>
                  ))}
              </select>
              <button
                className="btn-ghost text-xs text-rose-600"
                type="button"
                onClick={() => setBarcodeRows((rows) => rows.filter((_, i) => i !== index))}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
