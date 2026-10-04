import { round2 } from './pricing.js';
import { gstStateLabel, type GstDocumentType } from './gst.js';
import type { ReceiptDocument, ReceiptDocumentItem, ReceiptField } from './receiptLayout.js';

// What a printed or emailed sale or refund says, built the same way on screen and on the
// server (emailed receipts). How it is laid out is renderReceipt in receiptLayout.ts.

/** 03-10-2026, in `timeZone` (default: this device's). */
export function formatReceiptDate(iso: string, timeZone?: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone }).formatToParts(new Date(iso));
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('day')}-${part('month')}-${part('year')}`;
}

/** 07:45 PM, in `timeZone` (default: this device's). */
export function formatReceiptTime(iso: string, timeZone?: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone });
}

/** The GST facts a printed sale needs, all as recorded on the invoice when it was made. */
export type InvoiceGst = {
  documentType: GstDocumentType;
  sellerGstin: string | null;
  sellerStateCode: string | null;
  placeOfSupplyStateCode: string | null;
  /** A registered buyer: their name, GSTIN and billing address, as at the sale. */
  buyer?: { name: string; gstin: string; address: string | null } | null;
  /** The buyer's order or reference number. */
  reference?: string | null;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
};

/** The wording a composition taxpayer must print on every bill of supply. */
export const COMPOSITION_DECLARATION = 'Composition taxable person, not eligible to collect tax on supplies';

export function gstDocumentTitle(gst: InvoiceGst) {
  return gst.documentType === 'BILL_OF_SUPPLY' ? 'BILL OF SUPPLY' : 'TAX INVOICE';
}

/**
 * GSTIN, the place of supply when the goods went to another state, and for a registered buyer
 * their name, GSTIN and address (a tax invoice to a registered person must carry them).
 */
export function gstMetadata(gst: InvoiceGst): ReceiptField[] {
  const interState =
    !!gst.placeOfSupplyStateCode && !!gst.sellerStateCode && gst.placeOfSupplyStateCode !== gst.sellerStateCode;
  return [
    { label: 'GSTIN', value: gst.sellerGstin ?? '' },
    ...(interState
      ? [{ label: 'Place of Supply', value: gstStateLabel(gst.placeOfSupplyStateCode!), fullLine: true }]
      : []),
    ...(gst.buyer
      ? [
          { label: 'Buyer', value: gst.buyer.name, fullLine: true },
          { label: 'Buyer GSTIN', value: gst.buyer.gstin },
          ...(gst.buyer.address ? [{ label: 'Address', value: gst.buyer.address.replace(/\s*\n\s*/g, ', '), fullLine: true }] : []),
        ]
      : []),
    ...(gst.reference ? [{ label: 'Ref', value: gst.reference, fullLine: true }] : []),
  ];
}

/** The tax included in the total, by kind (CGST and SGST, or IGST). A bill of supply carries no tax. */
export function gstTaxAmounts(gst: InvoiceGst): Array<{ label: string; amount: number }> {
  if (gst.documentType === 'BILL_OF_SUPPLY') return [];
  if (gst.igstTotal > 0) return [{ label: 'incl. IGST', amount: gst.igstTotal }];
  if (gst.cgstTotal > 0 || gst.sgstTotal > 0) {
    return [
      { label: 'incl. CGST', amount: gst.cgstTotal },
      { label: 'incl. SGST', amount: gst.sgstTotal },
    ];
  }
  return [];
}

/** Lines printed after the store's footer: the composition declaration on a bill of supply. */
export function gstFooterLines(gst: InvoiceGst): string[] {
  return gst.documentType === 'BILL_OF_SUPPLY' ? [COMPOSITION_DECLARATION] : [];
}

/** The GST facts from an invoice as the API returns it (money as numbers or strings). */
export function invoiceGstOf(invoice: {
  documentType?: GstDocumentType | null;
  sellerGstin?: string | null;
  sellerStateCode?: string | null;
  placeOfSupplyStateCode?: string | null;
  customerName?: string | null;
  buyerGstin?: string | null;
  buyerAddress?: string | null;
  reference?: string | null;
  cgstTotal?: number | string | null;
  sgstTotal?: number | string | null;
  igstTotal?: number | string | null;
}): InvoiceGst {
  return {
    documentType: invoice.documentType ?? 'TAX_INVOICE',
    sellerGstin: invoice.sellerGstin ?? null,
    sellerStateCode: invoice.sellerStateCode ?? null,
    placeOfSupplyStateCode: invoice.placeOfSupplyStateCode ?? null,
    buyer: invoice.buyerGstin
      ? { name: invoice.customerName ?? '', gstin: invoice.buyerGstin, address: invoice.buyerAddress ?? null }
      : null,
    reference: invoice.reference ?? null,
    cgstTotal: Number(invoice.cgstTotal ?? 0),
    sgstTotal: Number(invoice.sgstTotal ?? 0),
    igstTotal: Number(invoice.igstTotal ?? 0),
  };
}

const nonEmpty = (lines: string[]) => lines.map((line) => line.trim()).filter(Boolean);

/** Header or footer text as entered in settings: one printed line per line. */
export const settingLines = (text: string | null | undefined) => nonEmpty((text ?? '').split('\n'));

/** What the store prints at the top and bottom of its receipts. */
export type ReceiptBranding = {
  storeName: string;
  headerLines: string[];
  footerLines: string[];
};

/** A sale: its invoice, payments so far and, when one was just taken, the payment's receipt. */
export function saleReceiptDocument(sale: {
  branding: ReceiptBranding;
  invoiceNo: string;
  receiptNo?: string | null;
  createdAt: string;
  cashier: string;
  customer: string;
  gst: InvoiceGst;
  items: ReceiptDocumentItem[];
  orderDiscount: number;
  grandTotal: number;
  payments: Array<{ mode: string; amount: number }>;
  paidTotal: number;
  /** Taken off the amount due by returns made before the bill was paid. */
  creditedTotal?: number;
  /** For the date and time; default: this device's. */
  timeZone?: string;
}): ReceiptDocument {
  const credited = sale.creditedTotal ?? 0;
  const fields: ReceiptField[] = [
    { label: 'Invoice', value: sale.invoiceNo },
    { label: 'Receipt', value: sale.receiptNo ?? '' },
    { label: 'Date', value: formatReceiptDate(sale.createdAt, sale.timeZone) },
    { label: 'Time', value: formatReceiptTime(sale.createdAt, sale.timeZone) },
    { key: 'cashier', label: 'Cashier', value: sale.cashier },
    { key: 'customer', label: 'Customer', value: sale.customer },
  ];
  return {
    title: gstDocumentTitle(sale.gst),
    storeName: sale.branding.storeName,
    headerLines: sale.branding.headerLines,
    footerLines: sale.branding.footerLines,
    // From the invoice, not the current settings: the GSTIN it was made under.
    legalFields: gstMetadata(sale.gst),
    fields,
    barcodeValue: sale.invoiceNo,
    items: sale.items,
    itemsTotal: sale.grandTotal + sale.orderDiscount,
    orderDiscount: sale.orderDiscount,
    taxTotals: gstTaxAmounts(sale.gst),
    grandTotalLabel: 'TOTAL',
    grandTotal: sale.grandTotal,
    payments: [
      ...sale.payments.map((payment) => ({ label: `Paid by ${payment.mode}`, amount: payment.amount })),
      ...(credited > 0 ? [{ label: 'Less returns', amount: credited }] : []),
    ],
    due: invoiceDue({ grandTotal: sale.grandTotal, paidTotal: sale.paidTotal, creditedTotal: credited }),
    legalFooter: gstFooterLines(sale.gst),
  };
}

const COMMON_GST_RATES = [0, 0.25, 1.5, 3, 5, 6, 12, 18, 28, 40];

/** A return line's GST rate from its amounts (the line keeps the tax, not the rate). */
export function rateFromAmounts(taxable: number, tax: number) {
  if (taxable <= 0 || tax <= 0) return 0;
  const rate = (tax / taxable) * 100;
  const nearest = COMMON_GST_RATES.reduce((best, known) => (Math.abs(known - rate) < Math.abs(best - rate) ? known : best));
  return Math.abs(nearest - rate) < 0.5 ? nearest : round2(rate);
}

/** What is still owed on a bill: its total less payments and returns taken off it. */
export function invoiceDue(invoice: { grandTotal: number | string; paidTotal: number | string; creditedTotal?: number | string | null }) {
  const due = Number(invoice.grandTotal) - Number(invoice.paidTotal) - Number(invoice.creditedTotal ?? 0);
  return Math.max(0, round2(due));
}

/**
 * How much of a return comes off what is still owed on the bill, and how much is handed back:
 * a bill not yet paid in full is first brought down, and only the rest is refunded.
 */
export function splitReturn(amount: number, due: number) {
  const dueAdjusted = round2(Math.min(amount, Math.max(0, due)));
  return { dueAdjusted, refundAmount: round2(amount - dueAdjusted) };
}

/** A return: what was refunded and how. */
export function returnReceiptDocument(refund: {
  branding: ReceiptBranding;
  returnNo: string;
  invoiceNo: string;
  createdAt: string;
  customer: string;
  refundMode: 'CASH' | 'WALLET';
  items: ReceiptDocumentItem[];
  totalAmount: number;
  /** Of totalAmount, what came off the amount still owed (the rest was refunded). */
  dueAdjusted?: number;
  tax: { cgst: number; sgst: number; igst: number };
  /** For the date and time; default: this device's. */
  timeZone?: string;
}): ReceiptDocument {
  const dueAdjusted = refund.dueAdjusted ?? 0;
  const refunded = round2(refund.totalAmount - dueAdjusted);
  const taxTotals = [
    ...(refund.tax.igst > 0 ? [{ label: 'incl. IGST', amount: refund.tax.igst }] : []),
    ...(refund.tax.cgst > 0 || refund.tax.sgst > 0
      ? [
          { label: 'incl. CGST', amount: refund.tax.cgst },
          { label: 'incl. SGST', amount: refund.tax.sgst },
        ]
      : []),
  ];
  return {
    title: refunded > 0 ? 'REFUND' : 'RETURN',
    storeName: refund.branding.storeName,
    headerLines: refund.branding.headerLines,
    footerLines: refund.branding.footerLines,
    legalFields: [],
    fields: [
      { label: 'Return', value: refund.returnNo },
      { label: 'Invoice', value: refund.invoiceNo },
      { label: 'Date', value: formatReceiptDate(refund.createdAt, refund.timeZone) },
      { label: 'Time', value: formatReceiptTime(refund.createdAt, refund.timeZone) },
      { key: 'customer', label: 'Customer', value: refund.customer },
    ],
    barcodeValue: null,
    items: refund.items,
    itemsTotal: null,
    orderDiscount: 0,
    taxTotals,
    grandTotalLabel: dueAdjusted > 0 ? 'RETURNED' : 'REFUND',
    grandTotal: refund.totalAmount,
    payments: [
      ...(dueAdjusted > 0 ? [{ label: 'Taken off amount due', amount: dueAdjusted }] : []),
      ...(refunded > 0 ? [{ label: refund.refundMode === 'WALLET' ? 'Credited to Wallet' : 'Refunded by Cash', amount: refunded }] : []),
    ],
    due: null,
    legalFooter: [],
  };
}

/** A sale line as the API returns it (money as numbers or strings). */
type InvoiceLine = {
  itemId: string;
  itemName: string;
  qty: number;
  rate: number | string;
  taxRate: number | string;
  taxMode?: 'INCLUSIVE' | 'EXCLUSIVE' | null;
  saleUom?: string | null;
  saleUomQty?: number | string | null;
  discountAmount: number | string;
  taxableAmount: number | string;
  taxAmount: number | string;
  netAmount: number | string;
  hsnCode?: string | null;
  discountAllocations?: Array<{ discountId: string; amount: number | string }>;
};

const formatQtyLabel = (qty: number) => (Number.isInteger(qty) ? qty.toFixed(0) : qty.toFixed(3));

/**
 * The items of a sale as the API returns it. `unitOf` gives an item's base unit (sale units are
 * on the line); `discounts` tells item discounts from order ones, which are shown once below.
 */
export function invoiceReceiptItems(
  lines: InvoiceLine[],
  discounts: Array<{ id: string; scope: 'ITEM' | 'ORDER' | string }>,
  unitOf: (itemId: string) => string | null | undefined = () => null
): ReceiptDocumentItem[] {
  const itemDiscountIds = new Set(discounts.filter((discount) => discount.scope === 'ITEM').map((discount) => discount.id));
  return lines.map((line) => {
    const qty = Number(line.qty);
    const pricingQty = line.saleUomQty != null ? Number(line.saleUomQty) : qty;
    const rate = Number(line.rate);
    const taxRate = Number(line.taxRate ?? 0);
    const gross = pricingQty * rate;
    const amount = line.taxMode === 'INCLUSIVE' && taxRate > 0 ? (gross * 100) / (100 + taxRate) : gross;
    const itemDiscount = (line.discountAllocations ?? []).reduce(
      (sum, allocation) => (itemDiscountIds.has(allocation.discountId) ? sum + Number(allocation.amount ?? 0) : sum),
      0
    );
    const orderDiscount = Number(line.discountAmount ?? 0) - itemDiscount;
    const unit = line.saleUom ?? unitOf(line.itemId);
    const shownQty = line.saleUom ? pricingQty : qty;
    return {
      name: line.itemName,
      hsn: line.hsnCode ?? null,
      qty: pricingQty,
      qtyLabel: unit ? `${formatQtyLabel(shownQty)} ${unit}` : formatQtyLabel(shownQty),
      rate: pricingQty > 0 ? amount / pricingQty : 0,
      amount,
      taxRate,
      taxAmount: Math.max(0, Number(line.taxAmount ?? 0)),
      discount: Math.max(0, itemDiscount),
      // Before the order discount, which is shown once under the items.
      total: Number(line.netAmount ?? 0) + orderDiscount,
      taxable: Number(line.taxableAmount ?? 0)
    };
  });
}
