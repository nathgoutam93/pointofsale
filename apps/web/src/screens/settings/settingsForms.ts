import type { CashierPermission } from "@pos/contracts";

// The settings page's forms, as typed (numbers stay text until saved).

export type SettingsForm = {
  name: string;
  code: string;
  logoUrl: string | null;
  receiptPrefix: string;
  invoiceHeader: string;
  invoiceFooter: string;
  receiptHeader: string;
  receiptFooter: string;
  invoiceCss: string;
  receiptCss: string;
  gstin: string;
  stateCode: string;
};

export type BusinessSettingsForm = {
  name: string;
  logoUrl: string | null;
  gstNumber: string;
  taxCalculationMode: "AFTER_DISCOUNT" | "BEFORE_DISCOUNT";
  cashierMaxDiscountPercent: string;
  customerScope: "SHARED" | "BRANCH";
  timezone: string;
  hsnMinDigits: 4 | 6;
  /** Days; empty for no limit. */
  returnWindowDays: string;
  roundOffMode: "NONE" | "NEAREST_1" | "NEAREST_050";
  allowNegativeStock: boolean;
  /** The weighing scale's label layout; `scaleEnabled` false for no scale. */
  scaleEnabled: boolean;
  scalePrefix: string;
  scaleItemDigits: string;
  scaleValueType: "WEIGHT" | "PRICE";
  scaleValueDigits: string;
  scaleValueDecimals: string;
};

export type CashierForm = {
  username: string;
  password: string;
  branchIds: string[];
  permissions: CashierPermission[];
};

export type CreateBranchForm = {
  name: string;
  code: string;
};

export const emptyCashierForm = (branchId: string): CashierForm => ({ username: "", password: "", branchIds: [branchId], permissions: [] });
