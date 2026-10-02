import { gstStateLabel, type GstDocumentType } from "@pos/contracts";
import type { ReceiptMetadata, ReceiptTotal } from "./receiptFormat";

/** The GST facts a printed sale needs, all as recorded on the invoice when it was made. */
export type InvoiceGst = {
  documentType: GstDocumentType;
  sellerGstin: string | null;
  sellerStateCode: string | null;
  placeOfSupplyStateCode: string | null;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
};

const money = (value: number) => value.toFixed(2);

/** The wording a composition taxpayer must print on every bill of supply. */
export const COMPOSITION_DECLARATION = "Composition taxable person, not eligible to collect tax on supplies";

export function gstDocumentTitle(gst: InvoiceGst) {
  return gst.documentType === "BILL_OF_SUPPLY" ? "BILL OF SUPPLY" : "TAX INVOICE";
}

/** GSTIN, and the place of supply when the goods went to another state. */
export function gstMetadata(gst: InvoiceGst): ReceiptMetadata[] {
  const interState =
    !!gst.placeOfSupplyStateCode && !!gst.sellerStateCode && gst.placeOfSupplyStateCode !== gst.sellerStateCode;
  return [
    { label: "GSTIN", value: gst.sellerGstin ?? "" },
    ...(interState
      ? [{ label: "Place of Supply", value: gstStateLabel(gst.placeOfSupplyStateCode!), fullLine: true }]
      : []),
  ];
}

/** The tax included in the total, by kind (CGST and SGST, or IGST). A bill of supply carries no tax. */
export function gstTaxTotals(gst: InvoiceGst): ReceiptTotal[] {
  if (gst.documentType === "BILL_OF_SUPPLY") return [];
  if (gst.igstTotal > 0) return [{ label: "incl. IGST", value: money(gst.igstTotal) }];
  if (gst.cgstTotal > 0 || gst.sgstTotal > 0) {
    return [
      { label: "incl. CGST", value: money(gst.cgstTotal) },
      { label: "incl. SGST", value: money(gst.sgstTotal) },
    ];
  }
  return [];
}

/** Lines printed after the store's footer: the composition declaration on a bill of supply. */
export function gstFooterLines(gst: InvoiceGst): string[] {
  return gst.documentType === "BILL_OF_SUPPLY" ? [COMPOSITION_DECLARATION] : [];
}

/** An item's HSN/SAC code as a receipt detail row, when it has one. */
export function hsnDetailRow(hsnCode: string | null | undefined) {
  return hsnCode ? [{ label: `HSN ${hsnCode}`, value: "" }] : [];
}

/** The GST facts from an invoice as the API returns it (money as numbers or strings). */
export function invoiceGstOf(invoice: {
  documentType?: GstDocumentType | null;
  sellerGstin?: string | null;
  sellerStateCode?: string | null;
  placeOfSupplyStateCode?: string | null;
  cgstTotal?: number | string | null;
  sgstTotal?: number | string | null;
  igstTotal?: number | string | null;
}): InvoiceGst {
  return {
    documentType: invoice.documentType ?? "TAX_INVOICE",
    sellerGstin: invoice.sellerGstin ?? null,
    sellerStateCode: invoice.sellerStateCode ?? null,
    placeOfSupplyStateCode: invoice.placeOfSupplyStateCode ?? null,
    cgstTotal: Number(invoice.cgstTotal ?? 0),
    sgstTotal: Number(invoice.sgstTotal ?? 0),
    igstTotal: Number(invoice.igstTotal ?? 0),
  };
}
