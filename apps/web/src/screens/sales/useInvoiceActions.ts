import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invoiceReceiptItems } from "@pos/contracts";
import { api, apiErrorMessage, authHeaders } from "../../lib/api";
import { invoiceGstOf } from "../../lib/gstReceipt";
import { getItemDiscountAmount } from "./salesFormat";
import type { PaymentMode, SettledSummary } from "./types";
import type { SettlePayment } from "./useSettlePayment";

/** Cancelling an unpaid draft bill, and settling what is owed on a bill. */
export function useInvoiceActions({
  branchId,
  itemUomById,
  receiptPrinting,
  payment,
  setSettledSummary,
  setSelectedInvoiceId,
  setSelectedReceiptId,
  setMessage,
}: {
  branchId: string;
  itemUomById: Map<string, string>;
  receiptPrinting: { openDrawer: () => Promise<void> };
  payment: Pick<SettlePayment, "setPaymentModalOpen" | "setPaymentLines" | "setPaymentAmount">;
  setSettledSummary: (summary: SettledSummary | null) => void;
  setSelectedInvoiceId: (id: string) => void;
  setSelectedReceiptId: (id: string) => void;
  setMessage: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const { setPaymentModalOpen, setPaymentLines, setPaymentAmount } = payment;

  const cancelInvoice = useMutation({
    mutationFn: async ({ invoiceId, reason }: { invoiceId: string; reason: string }) => {
      const res = await api.sales.cancel({
        params: { id: invoiceId },
        body: { reason },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) {
        throw new Error(apiErrorMessage(res.body, "Failed to cancel invoice"));
      }
      return res.body;
    },
    onSuccess: (invoice) => {
      setMessage(`Cancelled ${invoice.invoiceNo}; its stock is back on hand.`);
      queryClient.invalidateQueries({ queryKey: ["sales-module", branchId] });
      queryClient.invalidateQueries({ queryKey: ["sales-by-id", invoice.id] });
      queryClient.invalidateQueries({ queryKey: ["stock-module", branchId] });
    },
    onError: (error) => {
      setMessage((error as Error).message);
    },
  });

  const settleInvoice = useMutation({
    mutationFn: async (payload: {
      invoiceId: string;
      payments: Array<{ mode: PaymentMode; amount: number }>;
    }) => {
      const res = await api.sales.settle({
        params: { id: payload.invoiceId },
        body: { payments: payload.payments },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) {
        throw new Error(apiErrorMessage(res.body, "Failed to settle invoice"));
      }
      return res.body;
    },
    onSuccess: (result, payload) => {
      if (payload.payments.some((line) => line.mode === "CASH" && line.amount > 0)) {
        void receiptPrinting.openDrawer();
      }
      setSettledSummary({
        invoiceId: result.invoice.id,
        invoiceNo: result.invoice.invoiceNo,
        createdBy: result.invoice.createdBy,
        createdByName: result.invoice.createdByName,
        receiptId: result.receipt.id,
        receiptNo: result.receipt.receiptNo,
        receiptAmount: Number(result.receipt.amount),
        createdAt: result.receipt.createdAt,
        status: result.invoice.status,
        paidTotal: Number(result.invoice.paidTotal),
        creditedTotal: Number(result.invoice.creditedTotal ?? 0),
        subTotal: Number(result.invoice.subTotal),
        taxTotal: Number(result.invoice.taxTotal),
        grandTotal: Number(result.invoice.grandTotal),
        lines: result.invoice.lines.map((line) => ({
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
            result.invoice.discounts,
          ),
          orderDiscountAmount:
            Number(line.discountAmount ?? 0) -
            getItemDiscountAmount(line, result.invoice.discounts),
          taxMode: line.taxMode ?? "EXCLUSIVE",
          taxRate: Number(line.taxRate),
          taxAmount: Number(line.taxAmount ?? 0),
          taxableAmount: Number(line.taxableAmount ?? 0),
          netAmount: Number(line.netAmount),
          hsnCode: line.hsnCode ?? null,
        })),
        gst: invoiceGstOf(result.invoice),
        receiptItems: invoiceReceiptItems(result.invoice.lines, result.invoice.discounts, (itemId) => itemUomById.get(itemId)),
        payments: result.invoice.payments.map((line) => ({
          mode: line.mode,
          amount: Number(line.amount),
          tendered: line.tendered === null || line.tendered === undefined ? null : Number(line.tendered),
        })),
      });
      setPaymentModalOpen(false);
      setPaymentLines([]);
      setPaymentAmount("0");
      setSelectedInvoiceId(result.invoice.id);
      setSelectedReceiptId(result.receipt.id);
      setMessage(
        `${result.invoice.status === "SETTLED" ? "Settled" : "Payment recorded"}: ${result.invoice.invoiceNo}, Receipt: ${result.receipt.receiptNo}`,
      );
      queryClient.invalidateQueries({
        queryKey: ["sales-module", branchId],
      });
      queryClient.invalidateQueries({
        queryKey: ["sales-by-id", result.invoice.id],
      });
      queryClient.invalidateQueries({
        queryKey: ["receipt-list-by-invoice-sales", result.invoice.id],
      });
    },
  });

  return { cancelInvoice, settleInvoice };
}
