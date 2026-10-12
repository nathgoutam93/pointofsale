import type { Dispatch, SetStateAction } from "react";
import { emptySaleUom, type ItemFormState, type SaleUomFormState } from "./itemForm";

/** The other units the item is sold in (a box of 10), each with its own price. */
export function SaleUomEditor({
  form,
  saleUomRows,
  setSaleUomRows,
  resetMutationErrors,
}: {
  form: ItemFormState;
  saleUomRows: SaleUomFormState[];
  setSaleUomRows: Dispatch<SetStateAction<SaleUomFormState[]>>;
  resetMutationErrors: () => void;
}) {
  return (
    <div className="md:col-span-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-slate-600">
            Alternate Sale UOM
          </p>
          <p className="text-xs text-slate-500">
            Example: BOX converts to 10 {form.uom || "base units"} with its own price.
          </p>
        </div>
        <button
          className="btn-secondary text-xs"
          type="button"
          onClick={() => {
            resetMutationErrors();
            setSaleUomRows((rows) => [...rows, emptySaleUom()]);
          }}
        >
          Add UOM
        </button>
      </div>

      {saleUomRows.length === 0 ? (
        <p className="text-sm text-slate-500">No alternate sale UOMs.</p>
      ) : (
        <div className="space-y-2">
          {saleUomRows.map((row, index) => (
            <div
              key={index}
              className="grid grid-cols-1 gap-2 rounded-md border border-slate-200 bg-white p-2 md:grid-cols-[1fr_1fr_1fr_1fr_auto]"
            >
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-500">UOM</span>
                <input
                  className="field"
                  placeholder="BOX"
                  value={row.uom}
                  onChange={(e) =>
                    setSaleUomRows((rows) =>
                      rows.map((item, rowIndex) =>
                        rowIndex === index ? { ...item, uom: e.target.value } : item,
                      ),
                    )
                  }
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-500">Base Qty</span>
                <input
                  className="field"
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={row.conversionQty}
                  onChange={(e) =>
                    setSaleUomRows((rows) =>
                      rows.map((item, rowIndex) =>
                        rowIndex === index
                          ? { ...item, conversionQty: e.target.value }
                          : item,
                      ),
                    )
                  }
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-500">Sell Price</span>
                <input
                  className="field"
                  type="number"
                  min="0"
                  step="0.01"
                  value={row.sellPrice}
                  onChange={(e) =>
                    setSaleUomRows((rows) =>
                      rows.map((item, rowIndex) =>
                        rowIndex === index
                          ? { ...item, sellPrice: e.target.value }
                          : item,
                      ),
                    )
                  }
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-500">MRP</span>
                <input
                  className="field"
                  type="number"
                  min="0"
                  step="0.01"
                  value={row.mrp}
                  onChange={(e) =>
                    setSaleUomRows((rows) =>
                      rows.map((item, rowIndex) =>
                        rowIndex === index ? { ...item, mrp: e.target.value } : item,
                      ),
                    )
                  }
                />
              </label>
              <button
                className="btn-danger self-end text-xs"
                type="button"
                onClick={() =>
                  setSaleUomRows((rows) => rows.filter((_, rowIndex) => rowIndex !== index))
                }
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
