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
};

export type PostPaymentSummary = {
  invoiceNo: string;
  receiptNo?: string | null;
  createdAt: string;
  customerName: string;
  customerPhone: string;
  subTotal: number;
  orderDiscountAmount: number;
  taxTotal: number;
  grandTotal: number;
  paidTotal: number;
  paymentLines: Array<{ mode: "CASH" | "CARD" | "WALLET"; amount: number }>;
  lines: CartLine[];
};

export type PaymentMode = "CASH" | "CARD" | "WALLET";
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
  cart: CartLine[];
  orderDiscountMode: "AMOUNT" | "PERCENT";
  orderDiscountValue: string;
  total: number;
  totalItems: number;
};
