import type { DiscountInput, GstSupplyType } from '@pos/contracts';
import { PaymentMode, UserRole } from '@prisma/client';

export type SessionUser = {
  userId: string;
  /** Hosted server: the business the session belongs to. */
  businessId?: string;
  branchId?: string;
  registerId?: string;
  role: UserRole;
  /** When the token was signed (milliseconds); a password change ends sessions signed before it. */
  issuedAt?: number;
};

export type PaymentInput = {
  mode: PaymentMode;
  amount: number;
  reference?: string;
};

export type SaleLineInput = {
  itemId: string;
  itemName?: string;
  qty: number;
  rate: number;
  /** Catalog price per sale unit; set by the server, never taken from the request. */
  listRate?: number;
  /** Item cost per base unit at the time of sale; set by the server. */
  unitCost?: number;
  /** The item's GST details at the time of sale; set by the server. */
  hsnCode?: string | null;
  uqc?: string | null;
  supplyType?: GstSupplyType;
  saleUom?: string;
  saleUomQty?: number;
  saleUomConversionQty?: number;
  taxRate: number;
  taxMode?: 'INCLUSIVE' | 'EXCLUSIVE';
  discounts?: DiscountInput[];
};

export type CreateSaleInput = {
  branchId: string;
  customerId: string;
  walkInCustomerName?: string | null;
  walkInCustomerPhone?: string | null;
  lines: SaleLineInput[];
  discounts?: DiscountInput[];
  /** Set when goods are shipped to another state; defaults to the branch's state. */
  placeOfSupplyStateCode?: string;
  /** The buyer's order or reference number. */
  reference?: string;
  /** From POST /sales/checkout only; see checkoutSale. */
  idempotencyKey?: string;
};

export type ComputedSaleLine = SaleLineInput & {
  discountAmount: number;
  taxableAmount: number;
  taxAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  netAmount: number;
  grossAmount: number;
  baseExclusive: number;
  itemDiscountAmount: number;
  orderDiscountAmount: number;
};

export type ItemSaleUomInput = {
  uom: string;
  conversionQty: number;
  sellPrice: number;
  mrp?: number;
};
