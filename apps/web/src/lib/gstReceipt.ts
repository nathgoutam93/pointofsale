import { gstStateLabel, type GstDocumentType, type ReceiptField } from "@pos/contracts";

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

/** The wording a composition taxpayer must print on every bill of supply. */
export const COMPOSITION_DECLARATION = "Composition taxable person, not eligible to collect tax on supplies";

export function gstDocumentTitle(gst: InvoiceGst) {
  return gst.documentType === "BILL_OF_SUPPLY" ? "BILL OF SUPPLY" : "TAX INVOICE";
}

/** GSTIN, and the place of supply when the goods went to another state. */
export function gstMetadata(gst: InvoiceGst): ReceiptField[] {
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
export function gstTaxAmounts(gst: InvoiceGst): Array<{ label: string; amount: number }> {
  if (gst.documentType === "BILL_OF_SUPPLY") return [];
  if (gst.igstTotal > 0) return [{ label: "incl. IGST", amount: gst.igstTotal }];
  if (gst.cgstTotal > 0 || gst.sgstTotal > 0) {
    return [
      { label: "incl. CGST", amount: gst.cgstTotal },
      { label: "incl. SGST", amount: gst.sgstTotal },
    ];
  }
  return [];
}

/** Lines printed after the store's footer: the composition declaration on a bill of supply. */
export function gstFooterLines(gst: InvoiceGst): string[] {
  return gst.documentType === "BILL_OF_SUPPLY" ? [COMPOSITION_DECLARATION] : [];
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
