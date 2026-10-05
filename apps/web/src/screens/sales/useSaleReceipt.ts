import { useMemo } from "react";
import { batchLabel, invoiceReceiptItems } from "@pos/contracts";
import { receiptStyleFor, renderReceipt, saleReceiptDocument } from "../../lib/receipt";
import { invoiceGstOf } from "../../lib/gstReceipt";
import { getItemDiscountAmount } from "./salesFormat";
import type { CurrentInvoice, InvoiceReceipt, PaymentMode, SettledSummary } from "./types";
import type { InvoiceDetailsQuery } from "./useInvoiceDetails";
import type { ReceiptSettings } from "./useReceiptSettings";

/**
 * The bill on show, as the page lists it (lines, payments, totals) and as its receipt
 * prints. Just after a payment, from what settling returned.
 */
export function useSaleReceipt({
  settledSummary,
  selectedInvoiceDetails,
  currentInvoice,
  previewReceipt,
  currentSaleCreatorId,
  currentSaleCreatorName,
  formatSaleCreator,
  itemUomById,
  store,
}: {
  settledSummary: SettledSummary | null;
  selectedInvoiceDetails: InvoiceDetailsQuery;
  currentInvoice: CurrentInvoice | null;
  /** The receipt picked to print; the bill's first when none is. */
  previewReceipt: InvoiceReceipt | null;
  currentSaleCreatorId: string;
  currentSaleCreatorName: string;
  formatSaleCreator: (createdBy: string, createdByName?: string) => string;
  itemUomById: Map<string, string>;
  store: ReceiptSettings;
}) {
  const {
    businessSettings,
    storeDisplayName,
    receiptHeaderLines,
    receiptFooterLines,
    invoiceFooterLines,
    receiptTemplate,
    customReceiptCss,
  } = store;

  const saleLines =
    settledSummary?.lines ??
    selectedInvoiceDetails.data?.lines.map((line) => ({
      id: line.id,
      itemId: line.itemId,
      qty: Number(line.qty),
      rate: Number(line.rate),
      saleUom: line.saleUom,
      saleUomQty:
        line.saleUomQty === null ? null : Number(line.saleUomQty ?? 0) || null,
      saleUomConversionQty:
        line.saleUomConversionQty === null
          ? null
          : Number(line.saleUomConversionQty ?? 0) || null,
      itemName: line.itemName,
      discountAmount: Number(line.discountAmount ?? 0),
      itemDiscountAmount: getItemDiscountAmount(
        line,
        selectedInvoiceDetails.data?.discounts,
      ),
      orderDiscountAmount:
        Number(line.discountAmount ?? 0) -
        getItemDiscountAmount(line, selectedInvoiceDetails.data?.discounts),
      taxMode: line.taxMode ?? "EXCLUSIVE",
      taxRate: Number(line.taxRate),
      taxAmount: Number(line.taxAmount ?? 0),
      taxableAmount: Number(line.taxableAmount ?? 0),
      netAmount: Number(line.netAmount),
      hsnCode: line.hsnCode ?? null,
      batches: batchLabel(line.batches),
    })) ??
    [];

  const paymentBreakdown = useMemo(
    () =>
      settledSummary?.payments ??
      selectedInvoiceDetails.data?.payments.map((line) => ({
        mode: line.mode as PaymentMode,
        amount: Number(line.amount),
        tendered: line.tendered === null || line.tendered === undefined ? null : Number(line.tendered),
      })) ??
      [],
    [settledSummary?.payments, selectedInvoiceDetails.data],
  );

  const invoiceSubTotal =
    settledSummary?.subTotal ?? Number(currentInvoice?.subTotal ?? 0);
  const invoiceTaxTotal =
    settledSummary?.taxTotal ?? Number(currentInvoice?.taxTotal ?? 0);
  const invoiceGrandTotal =
    settledSummary?.grandTotal ?? Number(currentInvoice?.grandTotal ?? 0);
  const invoicePaidTotal =
    settledSummary?.paidTotal ?? Number(currentInvoice?.paidTotal ?? 0);

  const printableReceipt = useMemo(() => {
    if (!currentInvoice) return null;

    const createdAt =
      previewReceipt?.createdAt ??
      currentInvoice.createdAt ??
      new Date().toISOString();
    const cashier = currentSaleCreatorId
      ? formatSaleCreator(currentSaleCreatorId, currentSaleCreatorName)
      : "";

    // The same lines an emailed receipt has (invoiceReceiptItems), so the two never differ.
    const items =
      settledSummary?.receiptItems ??
      (selectedInvoiceDetails.data
        ? invoiceReceiptItems(selectedInvoiceDetails.data.lines, selectedInvoiceDetails.data.discounts, (itemId) => itemUomById.get(itemId))
        : []);

    const doc = saleReceiptDocument({
      branding: {
        storeName: storeDisplayName,
        headerLines: receiptHeaderLines,
        footerLines: receiptFooterLines.length > 0 ? receiptFooterLines : invoiceFooterLines,
      },
      invoiceNo: currentInvoice.invoiceNo,
      receiptNo: previewReceipt?.receiptNo ?? null,
      createdAt,
      cashier,
      customer: currentInvoice.customerName ?? "",
      // The GST facts recorded on the invoice, never the current settings.
      gst: settledSummary?.gst ?? invoiceGstOf(currentInvoice),
      items,
      orderDiscount: Number(currentInvoice.orderDiscountAmount ?? 0),
      grandTotal: invoiceGrandTotal,
      roundOff: Number(currentInvoice.roundOff ?? 0),
      payments: paymentBreakdown,
      paidTotal: invoicePaidTotal,
      creditedTotal: Number(currentInvoice.creditedTotal ?? 0),
      // The business's time, as on emailed receipts, whatever this computer's clock is set to.
      timeZone: businessSettings.data?.timezone,
    });
    return renderReceipt(doc, receiptTemplate);
  }, [
    currentInvoice,
    previewReceipt?.receiptNo,
    previewReceipt?.createdAt,
    currentSaleCreatorId,
    currentSaleCreatorName,
    formatSaleCreator,
    settledSummary?.receiptItems,
    selectedInvoiceDetails.data,
    itemUomById,
    invoiceGrandTotal,
    invoicePaidTotal,
    settledSummary?.gst,
    storeDisplayName,
    receiptHeaderLines,
    receiptFooterLines,
    invoiceFooterLines,
    receiptTemplate,
    paymentBreakdown,
    businessSettings.data?.timezone,
  ]);
  const receiptStyle = receiptStyleFor(printableReceipt ?? { columns: 48 }, receiptTemplate, customReceiptCss);

  return {
    saleLines,
    paymentBreakdown,
    invoiceSubTotal,
    invoiceTaxTotal,
    invoiceGrandTotal,
    printableReceipt,
    receiptStyle,
  };
}
