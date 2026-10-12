import { Prisma } from '@prisma/client';

export const branchSummarySelect = {
  id: true,
  name: true,
  code: true
} as const;

export const businessSettingsSelect = {
  id: true,
  name: true,
  logoUrl: true,
  gstNumber: true,
  cashierMaxDiscountPercent: true,
  customerScope: true,
  timezone: true,
  hsnMinDigits: true,
  returnWindowDays: true,
  roundOffMode: true,
  allowNegativeStock: true,
  scaleBarcode: true
} as const;

export const branchSettingsSelect = {
  id: true,
  name: true,
  code: true,
  logoUrl: true,
  receiptPrefix: true,
  invoiceHeader: true,
  invoiceFooter: true,
  receiptHeader: true,
  receiptFooter: true,
  invoiceCss: true,
  receiptCss: true,
  receiptTemplate: true,
  gstin: true,
  stateCode: true
} as const;

export const saleInvoiceInclude = {
  discounts: true,
  lines: {
    include: {
      discountAllocations: true
    }
  },
  payments: true
} satisfies Prisma.SaleInvoiceInclude;

export const registerSelect = {
  id: true,
  branchId: true,
  counterId: true,
  counter: { select: { name: true } },
  user: { select: { username: true } },
  openingBalance: true,
  closingBalance: true,
  expectedCash: true,
  cashDifference: true,
  openedAt: true,
  closedAt: true
} as const;
