import type { api } from "../../lib/api";
import { emptyGstItemForm, type GstItemForm } from "./GstItemFields";

// The Items screen's form, as typed (numbers stay text until saved), and the items it lists.

export type Item = Extract<Awaited<ReturnType<typeof api.items.list>>, { status: 200 }>["body"][number];

/** The right-hand panel: an item's details, a form for a new item or a product with variants, or editing. */
export type PanelMode = "view" | "create" | "product" | "edit";

export type ItemFormState = {
  code: string;
  name: string;
  category: string;
  uom: string;
  leastCount: string;
  costPrice: string;
  sellPrice: string;
  mrp: string;
  taxMode: "INCLUSIVE" | "EXCLUSIVE";
  taxRate: string;
  gst: GstItemForm;
  /** Stock kept by batch, with expiry dates. */
  tracksBatches: boolean;
  imageFile: File | null;
};

export type SaleUomFormState = {
  uom: string;
  conversionQty: string;
  sellPrice: string;
  mrp: string;
};

export const initialForm: ItemFormState = {
  code: "",
  name: "",
  category: "",
  uom: "PCS",
  leastCount: "1",
  costPrice: "0",
  sellPrice: "0",
  mrp: "0",
  taxMode: "EXCLUSIVE",
  taxRate: "0",
  gst: emptyGstItemForm,
  tracksBatches: false,
  imageFile: null,
};

export const emptySaleUom = (): SaleUomFormState => ({
  uom: "",
  conversionQty: "1",
  sellPrice: "0",
  mrp: "0",
});

export function normalizeSaleUomRows(rows: SaleUomFormState[], baseUom: string) {
  const seen = new Set([baseUom.trim().toLowerCase()]);
  return rows
    .map((row) => ({
      uom: row.uom.trim(),
      conversionQty: Number(row.conversionQty),
      sellPrice: Number(row.sellPrice),
      mrp: Number(row.mrp),
    }))
    .filter((row) => {
      const key = row.uom.toLowerCase();
      if (!row.uom || seen.has(key)) return false;
      seen.add(key);
      return row.conversionQty > 0 && row.sellPrice >= 0 && row.mrp >= 0;
    });
}
