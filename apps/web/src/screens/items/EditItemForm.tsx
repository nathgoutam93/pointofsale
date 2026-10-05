import type { Dispatch, SetStateAction } from "react";
import { uploadSrc } from "../../lib/api";
import { BarcodeEditor } from "./BarcodeEditor";
import { GstItemFields } from "./GstItemFields";
import { initialForm, type Item, type ItemFormState, type SaleUomFormState } from "./itemForm";
import { SaleUomEditor } from "./SaleUomEditor";
import type { ItemMutations } from "./useItemMutations";

/** Changing the selected item: everything but its code, and replacing or removing its image. */
export function EditItemForm({
  selectedItem,
  form,
  setForm,
  saleUomRows,
  setSaleUomRows,
  barcodeRows,
  setBarcodeRows,
  setPanelMode,
  removeImageOnEdit,
  setRemoveImageOnEdit,
  imagePreviewUrl,
  formMrpProblem,
  hsnMinDigits,
  updateItem,
  resetMutationErrors,
}: {
  selectedItem: Item;
  form: ItemFormState;
  setForm: Dispatch<SetStateAction<ItemFormState>>;
  saleUomRows: SaleUomFormState[];
  setSaleUomRows: Dispatch<SetStateAction<SaleUomFormState[]>>;
  barcodeRows: Array<{ barcode: string; saleUom: string }>;
  setBarcodeRows: Dispatch<SetStateAction<Array<{ barcode: string; saleUom: string }>>>;
  setPanelMode: (mode: "view" | "create" | "edit") => void;
  removeImageOnEdit: boolean;
  setRemoveImageOnEdit: (remove: boolean) => void;
  imagePreviewUrl: string | null;
  formMrpProblem: string | null;
  hsnMinDigits: number;
  updateItem: ItemMutations["updateItem"];
  resetMutationErrors: () => void;
}) {
  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-semibold">Edit Item</h3>
        <button
          className="btn-secondary"
          type="button"
          onClick={() => {
            resetMutationErrors();
            setPanelMode("view");
            setRemoveImageOnEdit(false);
            setForm(initialForm);
            setSaleUomRows([]);
            setBarcodeRows([]);
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
          updateItem.mutate();
        }}
      >
        <div className="md:col-span-2">
          <p className="mb-1 text-xs font-medium text-slate-600">
            Item Image
          </p>
          <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-[180px_minmax(0,1fr)]">
            <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
              {removeImageOnEdit ? (
                <div className="flex h-36 items-center justify-center text-xs text-slate-500">
                  Image will be removed
                </div>
              ) : imagePreviewUrl ? (
                <img
                  src={imagePreviewUrl}
                  alt="New item upload preview"
                  className="h-36 w-full object-scale-down"
                />
              ) : selectedItem.imageUrl ? (
                <img
                  src={uploadSrc(selectedItem.imageUrl) ?? undefined}
                  alt={selectedItem.name}
                  className="h-36 w-full object-scale-down"
                />
              ) : (
                <div className="flex h-36 items-center justify-center text-xs text-slate-500">
                  No image
                </div>
              )}
            </div>
            <div className="space-y-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-600">
                  Replace image
                </span>
                <input
                  className="field"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) =>
                    setForm((s) => {
                      const nextFile = e.target.files?.[0] ?? null;
                      if (nextFile) setRemoveImageOnEdit(false);
                      return {
                        ...s,
                        imageFile: nextFile,
                      };
                    })
                  }
                />
              </label>
              {form.imageFile && (
                <p className="text-xs text-slate-600">
                  New image: {form.imageFile.name}
                </p>
              )}
              {form.imageFile && (
                <button
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700"
                  type="button"
                  onClick={() =>
                    setForm((s) => ({
                      ...s,
                      imageFile: null,
                    }))
                  }
                >
                  Clear selected image
                </button>
              )}
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={removeImageOnEdit}
                  onChange={(e) => {
                    const shouldRemove = e.target.checked;
                    setRemoveImageOnEdit(shouldRemove);
                    if (shouldRemove) {
                      setForm((s) => ({ ...s, imageFile: null }));
                    }
                  }}
                />
                Remove existing image
              </label>
            </div>
          </div>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">
            Code
          </span>
          <input
            className="field bg-slate-100"
            value={selectedItem.code}
            disabled
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">
            Name
          </span>
          <input
            className="field"
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
          disabled={updateItem.isPending}
        >
          {updateItem.isPending ? "Saving..." : "Save Changes"}
        </button>
      </form>
    </>
  );
}
