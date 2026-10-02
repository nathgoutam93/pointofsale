import type { DiscountInput } from '@pos/contracts';
import { PaymentMode, UserRole } from '@prisma/client';

export type SessionUser = {
  userId: string;
  branchId?: string;
  registerId?: string;
  role: UserRole;
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
  /** From POST /sales/checkout only; see checkoutSale. */
  idempotencyKey?: string;
};

export type ComputedSaleLine = SaleLineInput & {
  discountAmount: number;
  taxableAmount: number;
  taxAmount: number;
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
