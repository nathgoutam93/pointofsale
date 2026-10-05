import type { Dispatch, SetStateAction } from "react";
import { BarcodeEditor } from "./BarcodeEditor";
import { GstItemFields } from "./GstItemFields";
import type { ItemFormState, SaleUomFormState } from "./itemForm";
import { SaleUomEditor } from "./SaleUomEditor";
import type { ItemMutations } from "./useItemMutations";

/** A new item: its code, name, units, prices, barcodes, tax and image. */
export function CreateItemForm({
  form,
  setForm,
  saleUomRows,
  setSaleUomRows,
  barcodeRows,
  setBarcodeRows,
  setPanelMode,
  formMrpProblem,
  hsnMinDigits,
  createItem,
  resetMutationErrors,
}: {
  form: ItemFormState;
  setForm: Dispatch<SetStateAction<ItemFormState>>;
  saleUomRows: SaleUomFormState[];
  setSaleUomRows: Dispatch<SetStateAction<SaleUomFormState[]>>;
  barcodeRows: Array<{ barcode: string; saleUom: string }>;
  setBarcodeRows: Dispatch<SetStateAction<Array<{ barcode: string; saleUom: string }>>>;
  setPanelMode: (mode: "view" | "create" | "edit") => void;
  formMrpProblem: string | null;
  hsnMinDigits: number;
  createItem: ItemMutations["createItem"];
  resetMutationErrors: () => void;
}) {
  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-semibold">Create Item</h3>
        <button
          className="btn-secondary"
          type="button"
          onClick={() => {
            resetMutationErrors();
            setSaleUomRows([]);
            setBarcodeRows([]);
            setPanelMode("view");
          }}
        >
          Cancel
        </button>
      </div>
      <form
        className="grid grid-cols-1 gap-2 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          resetMutationErrors();
          createItem.mutate();
        }}
      >
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="text-xs font-medium text-slate-600">
            Item Image
          </span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) =>
              setForm((s) => ({
                ...s,
                imageFile: e.target.files?.[0] ?? null,
              }))
            }
          />
        </label>
        {form.imageFile && (
          <p className="text-xs text-slate-600 md:col-span-2">
            Selected image: {form.imageFile.name}
          </p>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">
            Code
          </span>
          <input
            className="field"
            placeholder="e.g. SKU-1001"
            value={form.code}
            onChange={(e) =>
              setForm((s) => ({ ...s, code: e.target.value }))
            }
            required
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">
            Name
          </span>
          <input
            className="field"
            placeholder="e.g. Classic T-Shirt"
            value={form.name}
            onChange={(e) =>
              setForm((s) => ({ ...s, name: e.target.value }))
            }
            required
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">
            Category
          </span>
          <input
            className="field"
            placeholder="Optional"
            value={form.category}
            onChange={(e) =>
              setForm((s) => ({ ...s, category: e.target.value }))
            }
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">
            UOM
          </span>
          <input
            className="field"
            placeholder="PCS"
            value={form.uom}
            onChange={(e) =>
              setForm((s) => ({ ...s, uom: e.target.value }))
            }
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">
            Least Count
          </span>
          <input
            className="field"
            type="number"
            min="0.001"
            step="0.001"
            value={form.leastCount}
            onChange={(e) =>
              setForm((s) => ({ ...s, leastCount: e.target.value }))
            }
            required
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">
            Cost Price
          </span>
          <input
            className="field"
            type="number"
            step="0.01"
            min="0"
            value={form.costPrice}
            onChange={(e) =>
              setForm((s) => ({ ...s, costPrice: e.target.value }))
            }
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">
            Sell Price
          </span>
          <input
            className="field"
            type="number"
            step="0.01"
            min="0"
            value={form.sellPrice}
            onChange={(e) =>
              setForm((s) => ({ ...s, sellPrice: e.target.value }))
            }
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">
            MRP
          </span>
          <input
            className="field"
            type="number"
            step="0.01"
            min="0"
            value={form.mrp}
            onChange={(e) =>
              setForm((s) => ({ ...s, mrp: e.target.value }))
            }
          />
          {formMrpProblem ? (
            <span className="text-xs text-rose-700">Price can't be above the MRP: {formMrpProblem}</span>
          ) : (
            <span className="text-xs text-slate-500">Includes GST. 0 if none is printed.</span>
          )}
        </label>
        <SaleUomEditor
          form={form}
          saleUomRows={saleUomRows}
          setSaleUomRows={setSaleUomRows}
          resetMutationErrors={resetMutationErrors}
        />
        <BarcodeEditor
          form={form}
          saleUomRows={saleUomRows}
          barcodeRows={barcodeRows}
          setBarcodeRows={setBarcodeRows}
        />
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">
            Tax Mode
          </span>
          <select
            className="field"
            value={form.taxMode}
            onChange={(e) =>
              setForm((s) => ({
                ...s,
                taxMode: e.target.value as "INCLUSIVE" | "EXCLUSIVE",
              }))
            }
          >
            <option value="EXCLUSIVE">Tax Exclusive</option>
            <option value="INCLUSIVE">Tax Inclusive</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">
            Tax %
          </span>
          <input
            className="field"
            type="number"
            step="0.01"
            min="0"
            value={form.taxRate}
            onChange={(e) =>
              setForm((s) => ({ ...s, taxRate: e.target.value }))
            }
          />
        </label>

        <GstItemFields
          value={form.gst}
          onChange={(gst) => setForm((s) => ({ ...s, gst }))}
          taxRate={Number(form.taxRate) || 0}
          uom={form.uom}
          hsnMinDigits={hsnMinDigits}
        />

        <button
          className="btn-primary md:col-span-2"
          type="submit"
          disabled={createItem.isPending}
        >
          {createItem.isPending ? "Creating..." : "Create Item"}
        </button>
      </form>
    </>
  );
}
