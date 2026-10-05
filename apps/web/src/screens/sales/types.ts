import type { ReceiptDocumentItem } from "@pos/contracts";
import type { InvoiceGst } from "../../lib/gstReceipt";
import type { InvoiceDetails } from "./useInvoiceDetails";
import type { SaleListInvoice } from "./useSalesList";

// Shapes used by the Sales screen and its parts.

export type PaymentMode = "CASH" | "CARD" | "UPI" | "WALLET";
export type PaymentFilter = "ALL" | "PENDING" | "SETTLED";

export type SettledSummary = {
  invoiceId: string;
  invoiceNo: string;
  createdBy: string;
  createdByName: string;
  receiptId: string;
  receiptNo: string;
  receiptAmount: number;
  createdAt: string;
  status: string;
  paidTotal: number;
  creditedTotal: number;
  subTotal: number;
  taxTotal: number;
  grandTotal: number;
  lines: Array<{
    id: string;
    itemId: string;
    itemName: string;
    qty: number;
    rate: number;
    saleUom?: string | null;
    saleUomQty?: number | null;
    saleUomConversionQty?: number | null;
    discountAmount: number;
    itemDiscountAmount?: number;
    orderDiscountAmount?: number;
    taxMode?: "INCLUSIVE" | "EXCLUSIVE";
    taxRate: number;
    taxAmount: number;
    taxableAmount: number;
    netAmount: number;
    hsnCode?: string | null;
  }>;
  payments: Array<{ mode: PaymentMode; amount: number; tendered?: number | null }>;
  gst: InvoiceGst;
  /** The receipt's lines, built as emailed receipts build them. */
  receiptItems: ReceiptDocumentItem[];
};

export type SaleLine = SettledSummary["lines"][number];

/** The bill on show: its full details once loaded, its row in the list until then. */
export type CurrentInvoice = InvoiceDetails | SaleListInvoice;

/** A receipt taken against the bill on show. */
export type InvoiceReceipt = {
  id: string;
  receiptNo: string;
  amount: number | string;
  createdAt: string;
};
