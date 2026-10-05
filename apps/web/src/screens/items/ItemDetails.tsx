import type { Dispatch, SetStateAction } from "react";
import { GST_SUPPLY_TYPE_LABELS } from "@pos/contracts";
import { uploadSrc } from "../../lib/api";
import type { Session } from "../../lib/session";
import { inr } from "../route-helpers";
import { BranchPricesSection } from "./BranchPricesSection";
import type { Item, ItemFormState, SaleUomFormState } from "./itemForm";
import type { ItemMutations } from "./useItemMutations";

/** The selected item: its details and unit prices, with Edit and Delete, and (admins) its branch prices. */
export function ItemDetails({
  session,
  canManageItems,
  selectedItem,
  selectedItemUnits,
  setForm,
  setSaleUomRows,
  setBarcodeRows,
  setPanelMode,
  setRemoveImageOnEdit,
  deleteItem,
  resetMutationErrors,
}: {
  session: Pick<Session, "role">;
  canManageItems: boolean;
  selectedItem: Item;
  selectedItemUnits: Array<{ uom: string; sellPrice: number | string; mrp: number | string }> | null;
  setForm: Dispatch<SetStateAction<ItemFormState>>;
  setSaleUomRows: Dispatch<SetStateAction<SaleUomFormState[]>>;
  setBarcodeRows: Dispatch<SetStateAction<Array<{ barcode: string; saleUom: string }>>>;
  setPanelMode: (mode: "view" | "create" | "edit") => void;
  setRemoveImageOnEdit: (remove: boolean) => void;
  deleteItem: ItemMutations["deleteItem"];
  resetMutationErrors: () => void;
}) {
  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">Item Details</h3>
        {canManageItems ? (
        <div className="flex items-center gap-2">
          <button
            className="btn-secondary"
            type="button"
            onClick={() => {
              resetMutationErrors();
              setForm({
                code: selectedItem.code,
                name: selectedItem.name,
                category: selectedItem.category || "",
                uom: selectedItem.uom,
                leastCount: String(selectedItem.leastCount ?? 1),
                costPrice: String(selectedItem.costPrice),
                sellPrice: String(selectedItem.sellPrice),
                mrp: String(
                  (selectedItem as { mrp?: number }).mrp ??
                    selectedItem.sellPrice,
                ),
                taxMode: selectedItem.taxMode,
                taxRate: String(selectedItem.taxRate),
                gst: {
                  hsnCode: selectedItem.hsnCode ?? "",
                  uqc: selectedItem.uqc ?? "",
                  supplyType: selectedItem.supplyType,
                },
                tracksBatches: selectedItem.tracksBatches,
                imageFile: null,
              });
              setSaleUomRows(
                (selectedItem.saleUoms ?? [])
                  .filter((variant) => !variant.isDefault)
                  .map((variant) => ({
                    uom: variant.uom,
                    conversionQty: String(variant.conversionQty),
                    sellPrice: String(variant.sellPrice),
                    mrp: String(variant.mrp),
                  })),
              );
              setBarcodeRows(
                (selectedItem.barcodes ?? []).map((entry) => ({ barcode: entry.barcode, saleUom: entry.saleUom ?? "" })),
              );
              setRemoveImageOnEdit(false);
              setPanelMode("edit");
            }}
          >
            Edit
          </button>
          <button
            className="btn-danger"
            type="button"
            onClick={() => {
              resetMutationErrors();
              if (
                !window.confirm(
                  "Delete this item? This only works if the item has no sales.",
                )
              )
                return;
              deleteItem.mutate();
            }}
            disabled={deleteItem.isPending}
          >
            {deleteItem.isPending ? "Deleting..." : "Delete"}
          </button>
        </div>
        ) : null}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
          {selectedItem.imageUrl ? (
            <img
              src={uploadSrc(selectedItem.imageUrl) ?? undefined}
              alt={selectedItem.name}
              className="h-52 w-full object-scale-down"
            />
          ) : (
            <div className="flex h-52 items-center justify-center text-sm text-slate-500">
              No image
            </div>
          )}
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-xs text-slate-500">Code</dt>
            <dd className="font-medium text-slate-900">
              {selectedItem.code}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Name</dt>
            <dd className="font-medium text-slate-900">
              {selectedItem.name}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Category</dt>
            <dd className="font-medium text-slate-900">
              {selectedItem.category || "Uncategorized"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">UOM</dt>
            <dd className="font-medium text-slate-900">
              {selectedItem.uom}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Least Count</dt>
            <dd className="font-medium text-slate-900">
              {selectedItem.leastCount}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Cost</dt>
            <dd className="font-medium text-slate-900">
              {inr(selectedItem.costPrice)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Sell Price</dt>
            <dd className="font-medium text-slate-900">
              {inr(selectedItem.sellPrice)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">MRP</dt>
            <dd className="font-medium text-slate-900">
              {inr((selectedItem as { mrp?: number }).mrp ?? selectedItem.sellPrice)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Tax Mode</dt>
            <dd className="font-medium text-slate-900">
              {selectedItem.taxMode}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Tax %</dt>
            <dd className="font-medium text-slate-900">
              {selectedItem.taxRate}%
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">HSN / SAC</dt>
            <dd className={selectedItem.hsnCode ? "font-medium text-slate-900" : "font-medium text-amber-700"}>
              {selectedItem.hsnCode ?? "Not set"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">GST unit</dt>
            <dd className={selectedItem.uqc ? "font-medium text-slate-900" : "font-medium text-amber-700"}>
              {selectedItem.uqc ?? "Not set"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">GST supply type</dt>
            <dd className="font-medium text-slate-900">
              {GST_SUPPLY_TYPE_LABELS[selectedItem.supplyType]}
            </dd>
          </div>
        </dl>
        <div className="md:col-span-2 overflow-hidden rounded-md border border-slate-200">
          <div className="border-b border-slate-200 bg-slate-50 px-3 py-2">
            <p className="eyebrow">
              Sale UOM Pricing
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="eyebrow">
                <tr>
                  <th className="px-3 py-2">UOM</th>
                  <th className="px-3 py-2">Base Qty</th>
                  <th className="px-3 py-2">Sell Price</th>
                  <th className="px-3 py-2">MRP</th>
                </tr>
              </thead>
              <tbody>
                {(selectedItem.saleUoms ?? []).length === 0 ? (
                  <tr className="border-t border-slate-100">
                    <td colSpan={4} className="px-3 py-4 text-center text-xs text-slate-500">
                      Sold only in {selectedItem.uom}. Add sale units from Edit to sell in packs or other units.
                    </td>
                  </tr>
                ) : null}
                {(selectedItem.saleUoms ?? []).map((variant) => (
                  <tr key={variant.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium text-slate-900">
                      {variant.uom}
                      {variant.isDefault ? (
                        <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-600">
                          Default
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {variant.conversionQty} {selectedItem.uom}
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {inr(variant.sellPrice)}
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {inr(variant.mrp)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {session.role === "ADMIN" && selectedItemUnits ? (
          <BranchPricesSection
            itemId={selectedItem.id}
            baseUom={selectedItem.uom}
            units={selectedItemUnits}
          />
        ) : null}
      </div>
    </>
  );
}
