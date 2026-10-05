import { renderReceipt, saleReceiptDocument, type ReceiptStyle } from "../../lib/receipt";
import { escapeHtml } from "../../lib/receiptFormat";
import { computeLineAmounts, formatQty, getBaseExclusive, getPricingQty } from "./cartMath";
import type { PostPaymentSummary } from "./types";
import type { StoreSettings } from "./useStoreSettings";

/** The printed receipt for a completed sale, laid out with the branch's receipt template. */
export function buildInvoiceReceipt(postPayment: PostPaymentSummary, store: StoreSettings, cashierName: string) {
  const items = postPayment.lines.map((line) => {
    const amounts = computeLineAmounts(line, store.taxCalculationMode);
    const netAmount = line.netAmount ?? amounts.net;
    const taxAmount = Number(line.taxAmount ?? amounts.tax);
    const baseExclusive = getBaseExclusive(line);
    const pricingQty = getPricingQty(line);
    const qtyLabel = line.saleUom
      ? `${line.saleUomQty ?? pricingQty} ${line.saleUom}`
      : `${formatQty(line.qty, line.leastCount)}${line.baseUom ? ` ${line.baseUom}` : ""}`;
    return {
      name: line.name,
      hsn: line.hsnCode ?? null,
      qty: pricingQty,
      qtyLabel,
      rate: pricingQty > 0 ? baseExclusive / pricingQty : 0,
      amount: baseExclusive,
      taxRate: line.taxRate,
      taxAmount,
      discount: Number(line.itemDiscountAmount ?? 0),
      // Before the order discount, which is shown once under the items.
      total: netAmount + Number(line.orderDiscountAmount ?? 0),
      taxable: netAmount - taxAmount,
    };
  });

  const doc = saleReceiptDocument({
    branding: {
      storeName: store.storeDisplayName,
      headerLines: store.invoiceHeaderLines,
      footerLines: store.invoiceFooterLines.length > 0 ? store.invoiceFooterLines : store.receiptFooterLines,
    },
    invoiceNo: postPayment.invoiceNo,
    receiptNo: postPayment.receiptNo,
    createdAt: postPayment.createdAt,
    cashier: cashierName,
    customer: postPayment.customerName,
    gst: postPayment.gst,
    items,
    orderDiscount: postPayment.orderDiscountAmount,
    grandTotal: postPayment.grandTotal,
    roundOff: postPayment.roundOff ?? 0,
    payments: postPayment.paymentLines,
    paidTotal: postPayment.paidTotal,
    // The business's time, as on emailed receipts, whatever this computer's clock is set to.
    timeZone: store.businessSettings.data?.timezone,
  });
  return renderReceipt(doc, store.printTemplate);
}

/**
 * A standalone HTML copy of the receipt shown on screen (for download or sharing), styled
 * with the receipt template and the branch's sanitized CSS.
 */
export function buildPrintableInvoiceDocument(postPayment: PostPaymentSummary, style: ReceiptStyle) {
  const invoiceElement = document.getElementById("printable-invoice");
  if (!invoiceElement) return null;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${escapeHtml(postPayment.invoiceNo)}</title><style>body{font-family:"Courier New",Courier,monospace;margin:0;padding:24px;background:#fff;color:#111827;}@media print{body{margin:0;}}${style.css}</style></head><body>${invoiceElement.outerHTML}</body></html>`;
}

/** Starts a browser download of an HTML document. */
export function downloadHtml(htmlDocument: string, fileName: string) {
  const blob = new Blob([htmlDocument], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
