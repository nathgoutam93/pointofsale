import {
  code128Modules,
  RECEIPT_PAPERS,
  renderReceipt,
  resolveReceiptTemplate,
  type ReceiptDocument,
  type ReceiptDocumentItem,
  type ReceiptField,
  type ReceiptLine,
  type ReceiptTemplate,
  type RenderedReceipt,
} from "@pos/contracts";
import { gstDocumentTitle, gstFooterLines, gstMetadata, gstTaxAmounts, type InvoiceGst } from "./gstReceipt";
import { escapeHtml, formatReceiptDate, formatReceiptTime } from "./receiptFormat";

export type { ReceiptDocument, ReceiptDocumentItem, ReceiptLine, ReceiptTemplate, RenderedReceipt };

/**
 * The template a branch prints with: its saved one, or the classic layout on the paper its old
 * receipt CSS asked for.
 */
export function branchReceiptTemplate(
  branch: { receiptTemplate?: unknown; receiptCss?: string | null; invoiceCss?: string | null } | null | undefined,
): ReceiptTemplate {
  return resolveReceiptTemplate(branch?.receiptTemplate ?? null, branch?.receiptCss || branch?.invoiceCss);
}

/** How a receipt is printed: the CSS styling it, its characters a line and its paper's width. */
export type ReceiptStyle = { css: string; columns: number; paperMm: 58 | 80 };

/**
 * The receipt's own CSS: a monospace column `columns` characters wide, as on the paper. `id`
 * is the receipt element's (another one for a preview, so it isn't what gets printed).
 */
export function receiptBaseCss(columns: number, id = "printable-invoice") {
  return `
    #${id} {
      font-family: "Courier New", Courier, monospace;
      --receipt-ch: ${columns};
      width: calc(var(--receipt-ch) * 1ch);
      max-width: 100%;
      margin: 0 auto;
      color: #111827;
      font-size: 12px;
      box-sizing: content-box;
    }
    #${id} .receipt-line {
      white-space: pre;
      font-size: 12px;
      line-height: 1.25;
    }
    #${id} .receipt-strong {
      font-weight: 700;
    }
    #${id} .receipt-line.receipt-large {
      font-size: 24px;
      line-height: 1.15;
    }
    #${id} .receipt-barcode {
      display: block;
      width: 100%;
      height: 48px;
      margin: 6px 0 2px;
    }
    #${id} .receipt-logo {
      display: block;
      margin: 0 auto 6px;
      max-height: 64px;
      max-width: 100%;
      object-fit: contain;
    }
  `;
}

/** The style a branch's receipts print with: its template's paper, plus its own sanitized CSS. */
export function receiptStyleFor(rendered: Pick<RenderedReceipt, "columns">, template: ReceiptTemplate, customCss: string): ReceiptStyle {
  return {
    css: `${receiptBaseCss(rendered.columns)}${customCss}`,
    columns: rendered.columns,
    paperMm: RECEIPT_PAPERS[template.paper].paperMm,
  };
}

/** Blank modules either side of a barcode, so a scanner finds where it starts and ends. */
const QUIET_ZONE = 10;

/** A Code 128 barcode as one SVG path in a box `width` modules wide and 1 tall. */
export function barcodePath(value: string) {
  const modules = code128Modules(value);
  let d = "";
  for (let start = 0; start < modules.length; ) {
    if (modules[start] !== "1") {
      start += 1;
      continue;
    }
    let end = start;
    while (modules[end] === "1") end += 1;
    d += `M${start + QUIET_ZONE} 0h${end - start}v1h-${end - start}z`;
    start = end;
  }
  return { d, width: modules.length + QUIET_ZONE * 2 };
}

function barcodeSvg(value: string) {
  const { d, width } = barcodePath(value);
  return `<svg class="receipt-barcode" viewBox="0 0 ${width} 1" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(value)}"><path d="${d}" fill="#000"/></svg>`;
}

const lineClass = (line: ReceiptLine) =>
  `receipt-line${line.strong ? " receipt-strong" : ""}${line.large ? " receipt-large" : ""}`;

/** The receipt as #printable-invoice markup, for printing one that isn't on the page. */
export function receiptMarkup(rendered: RenderedReceipt, logoSrc?: string | null) {
  const logo = rendered.showLogo && logoSrc ? `<img src="${escapeHtml(logoSrc)}" alt="" class="receipt-logo">` : "";
  const body = rendered.lines
    .map((line) =>
      line.barcode
        ? `${barcodeSvg(line.barcode)}<div class="${lineClass(line)}">${escapeHtml(line.text)}</div>`
        : `<div class="${lineClass(line)}">${escapeHtml(line.text)}</div>`,
    )
    .join("");
  return `<div id="printable-invoice">${logo}<div class="receipt-text">${body}</div></div>`;
}

export { lineClass as receiptLineClass };

const nonEmpty = (lines: string[]) => lines.map((line) => line.trim()).filter(Boolean);

/** Header or footer text as entered in settings: one printed line per line. */
export const settingLines = (text: string | null | undefined) => nonEmpty((text ?? "").split("\n"));

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
}): ReceiptDocument {
  const fields: ReceiptField[] = [
    { label: "Invoice", value: sale.invoiceNo },
    { label: "Receipt", value: sale.receiptNo ?? "" },
    { label: "Date", value: formatReceiptDate(sale.createdAt) },
    { label: "Time", value: formatReceiptTime(sale.createdAt) },
    { key: "cashier", label: "Cashier", value: sale.cashier },
    { key: "customer", label: "Customer", value: sale.customer },
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
    grandTotalLabel: "TOTAL",
    grandTotal: sale.grandTotal,
    payments: sale.payments.map((payment) => ({ label: `Paid by ${payment.mode}`, amount: payment.amount })),
    due: Math.max(0, sale.grandTotal - sale.paidTotal),
    legalFooter: gstFooterLines(sale.gst),
  };
}

const COMMON_GST_RATES = [0, 0.25, 1.5, 3, 5, 6, 12, 18, 28, 40];

/** A return line's GST rate from its amounts (the line keeps the tax, not the rate). */
export function rateFromAmounts(taxable: number, tax: number) {
  if (taxable <= 0 || tax <= 0) return 0;
  const rate = (tax / taxable) * 100;
  const nearest = COMMON_GST_RATES.reduce((best, known) => (Math.abs(known - rate) < Math.abs(best - rate) ? known : best));
  return Math.abs(nearest - rate) < 0.5 ? nearest : Math.round(rate * 100) / 100;
}

/** A return: what was refunded and how. */
export function returnReceiptDocument(refund: {
  branding: ReceiptBranding;
  returnNo: string;
  invoiceNo: string;
  createdAt: string;
  customer: string;
  refundMode: "CASH" | "WALLET";
  items: ReceiptDocumentItem[];
  totalAmount: number;
  tax: { cgst: number; sgst: number; igst: number };
}): ReceiptDocument {
  const taxTotals = [
    ...(refund.tax.igst > 0 ? [{ label: "incl. IGST", amount: refund.tax.igst }] : []),
    ...(refund.tax.cgst > 0 || refund.tax.sgst > 0
      ? [
          { label: "incl. CGST", amount: refund.tax.cgst },
          { label: "incl. SGST", amount: refund.tax.sgst },
        ]
      : []),
  ];
  return {
    title: "REFUND",
    storeName: refund.branding.storeName,
    headerLines: refund.branding.headerLines,
    footerLines: refund.branding.footerLines,
    legalFields: [],
    fields: [
      { label: "Return", value: refund.returnNo },
      { label: "Invoice", value: refund.invoiceNo },
      { label: "Date", value: formatReceiptDate(refund.createdAt) },
      { label: "Time", value: formatReceiptTime(refund.createdAt) },
      { key: "customer", label: "Customer", value: refund.customer },
    ],
    barcodeValue: null,
    items: refund.items,
    itemsTotal: null,
    orderDiscount: 0,
    taxTotals,
    grandTotalLabel: "REFUND",
    grandTotal: refund.totalAmount,
    payments: [
      { label: refund.refundMode === "WALLET" ? "Credited to Wallet" : "Refunded by Cash", amount: refund.totalAmount },
    ],
    due: null,
    legalFooter: [],
  };
}

/** A made-up sale for the layout preview and the test print, with the store's own branding. */
export function sampleReceiptDocument(branding: ReceiptBranding, options: { title?: string; gstin?: string | null } = {}): ReceiptDocument {
  const now = new Date().toISOString();
  const item = (name: string, hsn: string, qty: number, unit: string, rate: number, taxRate: number, discount: number): ReceiptDocumentItem => {
    const amount = Math.round(qty * rate * 100) / 100;
    const taxable = Math.round((amount - discount) * 100) / 100;
    const taxAmount = Math.round(taxable * taxRate) / 100;
    return { name, hsn, qty, qtyLabel: `${qty} ${unit}`, rate, amount, taxRate, taxAmount, discount, total: taxable + taxAmount, taxable };
  };
  const items = [
    item("Basmati Rice 5 kg", "1006", 2, "BAG", 450, 5, 20),
    item("Dish Wash Liquid 500 ml", "3402", 1, "PCS", 85, 18, 0),
    item("Notebook, 200 pages", "4820", 3, "PCS", 40, 12, 0),
  ];
  const grandTotal = Math.round(items.reduce((sum, line) => sum + line.total, 0) * 100) / 100;
  const tax = Math.round(items.reduce((sum, line) => sum + line.taxAmount, 0) * 100) / 100;
  const half = Math.round((tax / 2) * 100) / 100;
  return {
    title: options.title ?? "TAX INVOICE",
    storeName: branding.storeName,
    headerLines: branding.headerLines,
    footerLines: branding.footerLines,
    legalFields: options.gstin ? [{ label: "GSTIN", value: options.gstin }] : [],
    fields: [
      { label: "Invoice", value: "SAMPLE/0001" },
      { label: "Date", value: formatReceiptDate(now) },
      { label: "Time", value: formatReceiptTime(now) },
      { key: "cashier", label: "Cashier", value: "cashier" },
      { key: "customer", label: "Customer", value: "Walk In Customer" },
    ],
    barcodeValue: "SAMPLE/0001",
    items,
    itemsTotal: grandTotal,
    orderDiscount: 0,
    taxTotals: [
      { label: "incl. CGST", amount: half },
      { label: "incl. SGST", amount: Math.round((tax - half) * 100) / 100 },
    ],
    grandTotalLabel: "TOTAL",
    grandTotal,
    payments: [{ label: "Paid by CASH", amount: grandTotal }],
    due: 0,
    legalFooter: [],
  };
}

export { renderReceipt };
