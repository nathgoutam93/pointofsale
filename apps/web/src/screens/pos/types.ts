import type { InvoiceGst } from "../../lib/gstReceipt";

// Shapes used by the POS screen and its parts.

export type CartLine = {
  cartKey: string;
  itemId: string;
  name: string;
  qty: number;
  leastCount: number;
  rate: number;
  baseUom?: string;
  saleUom?: string;
  saleUomQty?: number;
  saleUomConversionQty?: number;
  discountAmount: number;
  itemDiscountAmount?: number;
  orderDiscountAmount?: number;
  taxRate: number;
  taxAmount?: number;
  taxMode: "INCLUSIVE" | "EXCLUSIVE";
  imageUrl?: string | null;
  netAmount?: number;
  /** On a completed sale's lines: the HSN/SAC code it was sold under. */
  hsnCode?: string | null;
};

export type PostPaymentSummary = {
  invoiceId: string;
  invoiceNo: string;
  receiptNo?: string | null;
  createdAt: string;
  customerName: string;
  customerPhone: string;
  /** The customer's saved email, offered by "Email the receipt". */
  customerEmail?: string | null;
  subTotal: number;
  orderDiscountAmount: number;
  taxTotal: number;
  grandTotal: number;
  paidTotal: number;
  paymentLines: Array<{ mode: PaymentMode; amount: number; tendered?: number | null }>;
  lines: CartLine[];
  /** The invoice's GST facts as recorded at the sale (document type, GSTIN, tax split). */
  gst: InvoiceGst;
};

export type PaymentMode = "CASH" | "CARD" | "UPI" | "WALLET";
export type PaymentMethod = PaymentMode | "CREDIT";

export type LeaveChoice = "save" | "discard" | "stay";

export type LocalSaleDraft = {
  id: string;
  savedAt: string;
  customerId: string;
  customerName: string;
  customerPhone?: string | null;
  walkInCustomerName?: string | null;
  walkInCustomerPhone?: string | null;
  /** Set when the goods are shipped to another state. */
  placeOfSupplyStateCode?: string | null;
  /** The buyer's order or reference number. */
  reference?: string | null;
  cart: CartLine[];
  orderDiscountMode: "AMOUNT" | "PERCENT";
  orderDiscountValue: string;
  total: number;
  totalItems: number;
};
