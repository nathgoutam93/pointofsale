import { gstDocumentTitle, gstFooterLines, gstMetadata, gstTaxTotals, hsnDetailRow } from "../../lib/gstReceipt";
import { buildReceiptLines, escapeHtml, formatReceiptDate, formatReceiptTime } from "../../lib/receiptFormat";
import { money } from "../route-helpers";
import { computeLineAmounts, formatQty, getBaseExclusive, getPricingQty } from "./cartMath";
import type { PostPaymentSummary } from "./types";
import type { StoreSettings } from "./useStoreSettings";

/** The text lines of the printed receipt for a completed sale. */
export function buildInvoiceReceiptLines(postPayment: PostPaymentSummary, store: StoreSettings, cashierName: string) {
  const createdAt = postPayment.createdAt;
  const metadata = [
    { label: "Invoice", value: postPayment.invoiceNo },
    ...(postPayment.receiptNo
      ? [{ label: "Receipt", value: postPayment.receiptNo }]
      : []),
    { label: "Date", value: formatReceiptDate(createdAt) },
    { label: "Time", value: formatReceiptTime(createdAt) },
    { label: "Cashier", value: cashierName ?? "" },
    { label: "Customer", value: postPayment.customerName },
    // From the invoice, not the current settings: the GSTIN it was made under.
    ...gstMetadata(postPayment.gst),
  ];

  const items = postPayment.lines.map((line) => {
    const netAmount = line.netAmount ?? computeLineAmounts(line, store.taxCalculationMode).net;
    const displayTotal = netAmount + Number(line.orderDiscountAmount ?? 0);
    const itemDiscount = Number(line.itemDiscountAmount ?? 0);
    const taxAmount = Number(line.taxAmount ?? 0);
    const baseExclusive = getBaseExclusive(line);
    const pricingQty = getPricingQty(line);
    const baseUnitRate = pricingQty > 0 ? baseExclusive / pricingQty : 0;
    const qtyLabel = line.saleUom
      ? `${line.saleUomQty ?? pricingQty} ${line.saleUom}`
      : `${formatQty(line.qty, line.leastCount)}${line.baseUom ? ` ${line.baseUom}` : ""}`;
    return {
      name: line.name,
      detailRows: [
        ...hsnDetailRow(line.hsnCode),
        {
          label: `${qtyLabel} x ${money(baseUnitRate)}`,
          value: money(baseExclusive),
        },
        ...(line.taxRate > 0 || taxAmount > 0
          ? [{ label: `tax ${line.taxRate}%`, value: money(taxAmount) }]
          : []),
        ...(itemDiscount > 0
          ? [{ label: "discount", value: `-${money(itemDiscount)}` }]
          : []),
      ],
      totalLabel: "line total",
      qty: line.qty,
      price: line.rate,
      total: displayTotal,
    };
  });

  const totals = [
    { label: "Items Total", value: money(postPayment.grandTotal + postPayment.orderDiscountAmount) },
    ...(postPayment.orderDiscountAmount > 0
      ? [
          {
            label: "Order Discount",
            value: `- ${money(postPayment.orderDiscountAmount)}`,
          },
        ]
      : []),
    ...gstTaxTotals(postPayment.gst),
    { label: "TOTAL", value: money(postPayment.grandTotal), isGrandTotal: true },
  ];

  const payments = postPayment.paymentLines.map((line) => ({
    label: `Paid by ${line.mode}`,
    value: money(line.amount),
  }));
  const remainingDue = Math.max(
    0,
    postPayment.grandTotal - postPayment.paidTotal,
  );
  const paymentSummary = [
    ...payments,
    { label: "Remaining Due", value: money(remainingDue) },
  ];

  const footerLines = [
    ...(store.invoiceFooterLines.length > 0 ? store.invoiceFooterLines : store.receiptFooterLines),
    ...gstFooterLines(postPayment.gst),
  ];

  return buildReceiptLines({
    width: store.receiptCharWidth,
    storeName: store.storeDisplayName,
    headerLines: store.invoiceHeaderLines,
    title: gstDocumentTitle(postPayment.gst),
    metadata,
    items,
    totals,
    payments: paymentSummary,
    footerLines,
  });
}

/**
 * A standalone HTML copy of the receipt shown on screen (for download or sharing), styled
 * with the receipt template and the branch's sanitized CSS.
 */
export function buildPrintableInvoiceDocument(postPayment: PostPaymentSummary, store: StoreSettings) {
  const invoiceElement = document.getElementById("printable-invoice");
  if (!invoiceElement) return null;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${escapeHtml(postPayment.invoiceNo)}</title><style>body{font-family:\"Courier New\",Courier,monospace;margin:0;padding:24px;background:#fff;color:#111827;}@media print{body{margin:0;}}${store.receiptTemplateCss}${store.customReceiptCss}</style></head><body>${invoiceElement.outerHTML}</body></html>`;
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
