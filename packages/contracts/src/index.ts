import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { RECEIPT_CSS_MAX_LENGTH, sanitizeReceiptCss } from './receiptCss.js';

export { RECEIPT_CSS_MAX_LENGTH, RECEIPT_CSS_SCOPE, sanitizeReceiptCss } from './receiptCss.js';
export type { ReceiptCssResult } from './receiptCss.js';
export { exclusiveBase, lineTax, returnLineRefund } from './pricing.js';

const c = initContract();

const roleSchema = z.enum(['ADMIN', 'CASHIER']);
const paymentModeSchema = z.enum(['CASH', 'CARD', 'WALLET']);
const returnRefundModeSchema = z.enum(['CASH', 'WALLET']);
const invoiceStatusSchema = z.enum(['DRAFT', 'SETTLED', 'PARTIALLY_SETTLED', 'CANCELLED']);
const stockTxnTypeSchema = z.enum(['OPENING', 'ADJUSTMENT_PLUS', 'ADJUSTMENT_MINUS', 'SALE', 'RETURN', 'SALE_CANCEL']);
const walletTxnTypeSchema = z.enum(['TOPUP', 'DEBIT_SALE', 'REFUND_RETURN', 'ADJUSTMENT']);
const taxModeSchema = z.enum(['INCLUSIVE', 'EXCLUSIVE']);
const taxCalculationModeSchema = z.enum(['AFTER_DISCOUNT', 'BEFORE_DISCOUNT']);
/** SHARED: customers and wallets work at every branch. BRANCH: only at the branch that created them. */
const customerScopeSchema = z.enum(['SHARED', 'BRANCH']);

/** True when the runtime (Node or browser) knows this IANA time zone. */
export function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}
const timeZoneSchema = z.string().trim().min(1).refine(isValidTimeZone, { message: 'Unknown time zone' });
const discountScopeSchema = z.enum(['ITEM', 'ORDER']);
const discountTypeSchema = z.enum(['PERCENTAGE', 'FIXED']);

export const moneySchema = z.number().finite();
const taxRateSchema = z.number().min(0).max(100);
const requiredText = z.string().trim().min(1);
const passwordSchema = z.string().min(8).max(128);
/** Branch codes and document prefixes become part of invoice, receipt and return numbers. */
const documentCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(16)
  .regex(/^[A-Za-z0-9/-]+$/, 'Use only letters, digits, "-" and "/"');
/** Branch receipt CSS: rejected when sanitizing would drop anything, so the admin sees why. */
const receiptCssSchema = z
  .string()
  .max(RECEIPT_CSS_MAX_LENGTH)
  .superRefine((css, ctx) => {
    if (css.length > RECEIPT_CSS_MAX_LENGTH) return; // already reported by .max()
    for (const problem of sanitizeReceiptCss(css).problems) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
    }
  });

/** Rejects arrays where two entries share the same key (e.g. the same sale line twice). */
const uniqueBy = <T>(key: (entry: T) => string, message: string) =>
  (entries: T[], ctx: z.RefinementCtx) => {
    const seen = new Set<string>();
    entries.forEach((entry, index) => {
      const value = key(entry);
      if (seen.has(value)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index], message });
      }
      seen.add(value);
    });
  };

export const branchSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string()
});

export const registerSessionSchema = z.object({
  id: z.string().uuid(),
  branchId: z.string().uuid(),
  openingBalance: moneySchema,
  /** Cash counted at close. */
  closingBalance: moneySchema.nullable(),
  /** Opening balance + cash taken − cash refunded, worked out at close. */
  expectedCash: moneySchema.nullable(),
  /** closingBalance − expectedCash; negative means cash was short. */
  cashDifference: moneySchema.nullable(),
  openedAt: z.string().datetime(),
  closedAt: z.string().datetime().nullable()
});

/** Running cash for a register: cash payments taken on it and cash refunds given from it. */
const registerCashSchema = z.object({
  cashSales: moneySchema,
  cashRefunds: moneySchema,
  expectedCash: moneySchema
});

export const registerSummarySchema = z.object({
  branchId: z.string().uuid(),
  current: registerSessionSchema.nullable(),
  lastClosed: registerSessionSchema.nullable()
});

export const branchSettingsSchema = branchSchema.extend({
  logoUrl: z.string().nullable(),
  invoicePrefix: z.string(),
  receiptPrefix: z.string(),
  returnPrefix: z.string(),
  invoiceHeader: z.string().nullable(),
  invoiceFooter: z.string().nullable(),
  receiptHeader: z.string().nullable(),
  receiptFooter: z.string().nullable(),
  invoiceCss: z.string().nullable(),
  receiptCss: z.string().nullable()
});

export const businessSettingsSchema = z.object({
  id: z.string(),
  name: z.string(),
  logoUrl: z.string().nullable(),
  gstNumber: z.string().nullable(),
  taxCalculationMode: taxCalculationModeSchema,
  cashierMaxDiscountPercent: z.number(),
  customerScope: customerScopeSchema,
  /** IANA zone report periods are worked out in, e.g. Asia/Kolkata. */
  timezone: z.string()
});

export const userSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  role: roleSchema,
  branchId: z.string().uuid(),
  branchIds: z.array(z.string().uuid()),
  isActive: z.boolean(),
  createdAt: z.string().datetime()
});

export const customerSchema = z.object({
  id: z.string().uuid(),
  branchId: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  isWalkIn: z.boolean(),
  createdAt: z.string().datetime()
});

export const walletSchema = z.object({
  customerId: z.string().uuid(),
  branchId: z.string().uuid(),
  balance: moneySchema
});

export const walletTxnSchema = z.object({
  id: z.string().uuid(),
  walletAccountId: z.string().uuid(),
  type: walletTxnTypeSchema,
  amount: moneySchema,
  referenceType: z.string().nullable(),
  referenceId: z.string().nullable(),
  createdAt: z.string().datetime()
});

export const itemSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  category: z.string().nullable(),
  uom: z.string(),
  leastCount: z.number().positive(),
  costPrice: moneySchema,
  sellPrice: moneySchema,
  mrp: moneySchema,
  taxMode: taxModeSchema,
  taxRate: z.number().min(0),
  imageUrl: z.string().url().nullable(),
  isActive: z.boolean(),
  createdAt: z.string().datetime()
});

const itemSaleUomInputSchema = z.object({
  uom: requiredText,
  conversionQty: z.number().positive(),
  sellPrice: moneySchema.nonnegative(),
  mrp: moneySchema.nonnegative().optional()
});

const itemSaleUomSchema = itemSaleUomInputSchema.extend({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
  mrp: moneySchema,
  isDefault: z.boolean(),
  sortOrder: z.number(),
  createdAt: z.string().datetime()
});

export const itemWithSaleUomsSchema = itemSchema.extend({
  saleUoms: z.array(itemSaleUomSchema)
});

const discountInputSchema = z
  .object({
    type: discountTypeSchema,
    value: moneySchema.nonnegative()
  })
  .refine((discount) => discount.type !== 'PERCENTAGE' || discount.value <= 100, {
    message: 'Percentage discount cannot be more than 100',
    path: ['value']
  });

const discountSchema = z.object({
  id: z.string().uuid(),
  scope: discountScopeSchema,
  type: discountTypeSchema,
  value: moneySchema.nonnegative()
});

const discountAllocationSchema = z.object({
  id: z.string().uuid(),
  discountId: z.string().uuid(),
  amount: moneySchema.nonnegative()
});

const saleLineInput = z.object({
  itemId: z.string().uuid(),
  qty: z.number().positive(),
  rate: moneySchema.nonnegative(),
  saleUom: z.string().optional(),
  saleUomQty: z.number().positive().optional(),
  saleUomConversionQty: z.number().positive().optional(),
  taxRate: taxRateSchema,
  taxMode: taxModeSchema.optional(),
  discounts: z.array(discountInputSchema).default([])
});

const saleUomInputListSchema = z
  .array(itemSaleUomInputSchema)
  .superRefine(uniqueBy((entry) => entry.uom.toUpperCase(), 'Sale unit is listed more than once'));

const saleLineSchema = saleLineInput.omit({ discounts: true }).extend({
  id: z.string().uuid(),
  itemName: z.string(),
  discountAmount: moneySchema,
  saleUom: z.string().nullable(),
  saleUomQty: z.number().positive().nullable(),
  saleUomConversionQty: z.number().positive().nullable(),
  listRate: moneySchema.nullable(),
  taxableAmount: moneySchema,
  taxAmount: moneySchema,
  netAmount: moneySchema,
  discountAllocations: z.array(discountAllocationSchema)
});

const returnLineForSaleLineSchema = z.object({
  id: z.string().uuid(),
  returnInvoiceId: z.string().uuid(),
  qty: z.number().positive(),
  amount: moneySchema
});

const paymentSchema = z.object({
  id: z.string().uuid(),
  invoiceId: z.string().uuid(),
  mode: paymentModeSchema,
  amount: moneySchema,
  reference: z.string().nullable(),
  createdAt: z.string().datetime()
});

const saleInvoiceSchema = z.object({
  id: z.string().uuid(),
  branchId: z.string().uuid(),
  invoiceNo: z.string(),
  customerId: z.string().uuid(),
  customerName: z.string(),
  customerPhone: z.string().nullable(),
  subTotal: moneySchema,
  discountTotal: moneySchema,
  orderDiscountAmount: moneySchema.default(0),
  taxTotal: moneySchema,
  grandTotal: moneySchema,
  paidTotal: moneySchema,
  status: invoiceStatusSchema,
  createdBy: z.string().uuid(),
  createdByName: z.string(),
  createdAt: z.string().datetime(),
  discounts: z.array(discountSchema)
});

const saleInvoiceWithLinesSchema = saleInvoiceSchema.extend({
  lines: z.array(saleLineSchema),
  payments: z.array(paymentSchema)
});

const saleInvoiceDetailSchema = saleInvoiceSchema.extend({
  lines: z.array(saleLineSchema.extend({ returnLines: z.array(returnLineForSaleLineSchema) })),
  payments: z.array(paymentSchema)
});

const stockLedgerSchema = z.object({
  id: z.string().uuid(),
  branchId: z.string().uuid(),
  itemId: z.string().uuid(),
  txnType: stockTxnTypeSchema,
  qtyIn: z.number().nonnegative(),
  qtyOut: z.number().nonnegative(),
  costPrice: moneySchema.nonnegative(),
  reason: z.string().nullable(),
  referenceType: z.string().nullable(),
  referenceId: z.string().nullable(),
  createdAt: z.string().datetime()
});

const receiptSchema = z.object({
  id: z.string().uuid(),
  receiptNo: z.string(),
  invoiceId: z.string().uuid(),
  amount: moneySchema,
  createdAt: z.string().datetime()
});

const returnSchema = z.object({
  id: z.string().uuid(),
  saleInvoiceId: z.string().uuid(),
  returnNo: z.string(),
  totalAmount: moneySchema,
  refundMode: returnRefundModeSchema,
  createdAt: z.string().datetime()
});

const returnListItemSchema = returnSchema.extend({
  saleInvoiceNo: z.string(),
  customerName: z.string(),
  lineCount: z.number().int().nonnegative()
});

const returnDetailSchema = returnSchema.extend({
  saleInvoiceNo: z.string(),
  customerName: z.string(),
  lines: z.array(
    z.object({
      id: z.string().uuid(),
      saleLineId: z.string().uuid(),
      itemId: z.string().uuid(),
      itemName: z.string(),
      qty: z.number().positive(),
      amount: moneySchema
    })
  )
});

const reportRangeSchema = z.object({
  label: z.string(),
  startDate: z.string().datetime().nullable(),
  endDate: z.string().datetime().nullable(),
  /** Settled invoices in the range. */
  invoiceCount: z.number().int().nonnegative(),
  /** Settled sales including tax. */
  grossSales: moneySchema,
  taxCollected: moneySchema,
  /** Refunds including tax, and their pre-tax part. */
  returnsGross: moneySchema,
  returnsNet: moneySchema,
  /** Pre-tax sales minus pre-tax returns. */
  netSales: moneySchema,
  /** Cost of items sold minus cost of items returned, at the cost recorded when sold. */
  costOfGoodsSold: moneySchema,
  /** netSales - costOfGoodsSold. */
  grossProfit: moneySchema,
  /** Still owed on unpaid or part-paid (credit) invoices created in the range; not in sales. */
  unpaidSales: moneySchema
});

const saleCreateBodySchema = z.object({
  branchId: z.string().uuid(),
  customerId: z.string().uuid(),
  walkInCustomerName: z.string().trim().optional().nullable(),
  walkInCustomerPhone: z.string().trim().optional().nullable(),
  lines: z.array(saleLineInput).min(1),
  discounts: z.array(discountInputSchema).default([])
});

const paymentInputSchema = z.object({ mode: paymentModeSchema, amount: moneySchema.positive(), reference: z.string().optional() });

export const appContract = c.router({
  auth: {
    login: {
      method: 'POST',
      path: '/auth/login',
      body: z.object({ username: z.string(), password: z.string() }),
      responses: {
        200: z.object({
          token: z.string(),
          userId: z.string().uuid(),
          username: z.string(),
          role: roleSchema,
          branchId: z.string().uuid().nullable(),
          registerId: z.string().uuid().nullable(),
          branches: z.array(branchSchema)
        })
      }
    },
    me: {
      method: 'GET',
      path: '/auth/me',
      responses: {
        200: z.object({
          userId: z.string().uuid(),
          username: z.string(),
          role: roleSchema,
          branchId: z.string().uuid().optional(),
          registerId: z.string().uuid().optional(),
          branches: z.array(branchSchema)
        })
      }
    }
  },
  business: {
    get: {
      method: 'GET',
      path: '/business/settings',
      responses: { 200: businessSettingsSchema }
    },
    update: {
      method: 'PATCH',
      path: '/business/settings',
      body: z.object({
        name: z.string().optional(),
        logoUrl: z.string().nullable().optional(),
        gstNumber: z.string().nullable().optional(),
        taxCalculationMode: taxCalculationModeSchema.optional(),
        cashierMaxDiscountPercent: z.number().min(0).max(100).optional(),
        customerScope: customerScopeSchema.optional(),
        timezone: timeZoneSchema.optional()
      }),
      responses: { 200: businessSettingsSchema }
    }
  },
  branches: {
    list: {
      method: 'GET',
      path: '/branches',
      responses: { 200: z.array(branchSchema) }
    },
    create: {
      method: 'POST',
      path: '/branches',
      body: z.object({
        name: requiredText,
        code: documentCodeSchema
      }),
      responses: { 201: branchSchema }
    },
    get: {
      method: 'GET',
      path: '/branches/:id',
      responses: { 200: branchSettingsSchema }
    },
    update: {
      method: 'PATCH',
      path: '/branches/:id',
      body: z.object({
        name: requiredText.optional(),
        code: documentCodeSchema.optional(),
        logoUrl: z.string().nullable().optional(),
        invoicePrefix: documentCodeSchema.optional(),
        receiptPrefix: documentCodeSchema.optional(),
        returnPrefix: documentCodeSchema.optional(),
        invoiceHeader: z.string().nullable().optional(),
        invoiceFooter: z.string().nullable().optional(),
        receiptHeader: z.string().nullable().optional(),
        receiptFooter: z.string().nullable().optional(),
        invoiceCss: receiptCssSchema.nullable().optional(),
        receiptCss: receiptCssSchema.nullable().optional()
      }),
      responses: { 200: branchSettingsSchema }
    }
  },
  customers: {
    list: {
      method: 'GET',
      path: '/customers',
      query: z.object({ branchId: z.string().uuid() }),
      responses: { 200: z.array(customerSchema) }
    },
    create: {
      method: 'POST',
      path: '/customers',
      body: z.object({ branchId: z.string().uuid(), name: requiredText, phone: z.string().optional() }),
      responses: { 201: customerSchema }
    },
    update: {
      method: 'PATCH',
      path: '/customers/:id',
      body: z.object({ name: requiredText.optional(), phone: z.string().nullable().optional() }),
      responses: { 200: customerSchema }
    },
    getWalkIn: {
      method: 'GET',
      path: '/customers/walk-in/:branchId',
      responses: { 200: customerSchema }
    },
    getWallet: {
      method: 'GET',
      path: '/customers/:id/wallet',
      responses: { 200: walletSchema }
    },
    topupWallet: {
      method: 'POST',
      path: '/customers/:id/wallet/topup',
      body: z.object({ amount: moneySchema.positive(), reference: z.string().optional() }),
      responses: { 200: walletTxnSchema }
    }
  },
  users: {
    list: {
      method: 'GET',
      path: '/users',
      query: z.object({ branchId: z.string().uuid() }),
      responses: { 200: z.array(userSchema) }
    },
    create: {
      method: 'POST',
      path: '/users',
      body: z.object({
        branchId: z.string().uuid(),
        username: requiredText,
        password: passwordSchema,
        branchIds: z
          .array(z.string().uuid())
          .superRefine(uniqueBy((id) => id, 'Branch is listed more than once'))
          .optional()
      }),
      responses: { 201: userSchema }
    },
    update: {
      method: 'PATCH',
      path: '/users/:id',
      body: z.object({
        username: requiredText.optional(),
        password: passwordSchema.optional(),
        isActive: z.boolean().optional()
      }),
      responses: { 200: userSchema }
    },
    grantBranchAccess: {
      method: 'POST',
      path: '/users/:id/branches/:branchId',
      body: z.undefined(),
      responses: { 204: z.undefined() }
    },
    revokeBranchAccess: {
      method: 'DELETE',
      path: '/users/:id/branches/:branchId',
      body: z.undefined(),
      responses: { 204: z.undefined() }
    }
  },
  registers: {
    open: {
      method: 'POST',
      path: '/registers/open',
      body: z.object({
        branchId: z.string().uuid(),
        openingBalance: moneySchema.nonnegative()
      }),
      responses: {
        200: z.object({
          token: z.string(),
          register: registerSessionSchema
        })
      }
    },
    summary: {
      method: 'GET',
      path: '/registers/summary',
      responses: {
        200: z.array(registerSummarySchema)
      }
    },
    current: {
      method: 'GET',
      path: '/registers/current',
      responses: {
        200: registerSessionSchema.merge(registerCashSchema).nullable()
      }
    },
    close: {
      method: 'POST',
      path: '/registers/close',
      body: z.object({
        closingBalance: moneySchema.nonnegative()
      }),
      responses: {
        200: z.object({
          token: z.string(),
          register: registerSessionSchema.merge(registerCashSchema.omit({ expectedCash: true }))
        })
      }
    }
  },
  items: {
    list: {
      method: 'GET',
      path: '/items',
      // Query strings arrive as text; z.coerce.boolean() would turn "false" into true.
      query: z.object({
        activeOnly: z
          .union([z.boolean(), z.enum(['true', 'false'])])
          .transform((value) => value === true || value === 'true')
          .optional()
      }),
      responses: { 200: z.array(itemWithSaleUomsSchema) }
    },
    create: {
      method: 'POST',
      path: '/items',
      body: z.object({
        code: requiredText,
        name: requiredText,
        category: z.string().optional(),
        uom: requiredText,
        leastCount: z.number().positive().optional(),
        costPrice: moneySchema.nonnegative().optional(),
        sellPrice: moneySchema.nonnegative(),
        mrp: moneySchema.nonnegative().optional(),
        saleUoms: saleUomInputListSchema.optional(),
        taxMode: taxModeSchema.optional(),
        taxRate: taxRateSchema,
        // A relative /uploads/... path from the upload endpoint, or a full URL.
        imageUrl: z.string().optional()
      }),
      responses: { 201: itemWithSaleUomsSchema }
    },
    update: {
      method: 'PATCH',
      path: '/items/:id',
      body: z.object({
        name: requiredText.optional(),
        category: z.string().nullable().optional(),
        uom: requiredText.optional(),
        leastCount: z.number().positive().optional(),
        costPrice: moneySchema.nonnegative().optional(),
        sellPrice: moneySchema.nonnegative().optional(),
        mrp: moneySchema.nonnegative().optional(),
        saleUoms: saleUomInputListSchema.optional(),
        taxMode: taxModeSchema.optional(),
        taxRate: taxRateSchema.optional(),
        imageUrl: z.string().nullable().optional(),
        isActive: z.boolean().optional()
      }),
      responses: { 200: itemWithSaleUomsSchema }
    },
    delete: {
      method: 'DELETE',
      path: '/items/:id',
      body: z.undefined(),
      responses: { 200: itemSchema }
    }
  },
  stock: {
    opening: {
      method: 'POST',
      path: '/stock/opening',
      body: z.object({
        branchId: z.string().uuid(),
        itemId: z.string().uuid(),
        qty: z.number().positive(),
        costPrice: moneySchema.nonnegative().optional(),
        reason: z.string().optional()
      }),
      responses: { 201: stockLedgerSchema }
    },
    updateOpening: {
      method: 'PATCH',
      path: '/stock/opening',
      body: z.object({
        branchId: z.string().uuid(),
        itemId: z.string().uuid(),
        qty: z.number().positive(),
        costPrice: moneySchema.nonnegative().optional(),
        reason: z.string().optional()
      }),
      responses: { 200: stockLedgerSchema }
    },
    adjustment: {
      method: 'POST',
      path: '/stock/adjustment',
      body: z.object({
        branchId: z.string().uuid(),
        itemId: z.string().uuid(),
        qty: z.number().positive(),
        direction: z.enum(['IN', 'OUT']),
        costPrice: moneySchema.nonnegative().optional(),
        reason: requiredText
      }),
      responses: { 201: stockLedgerSchema }
    },
    onHand: {
      method: 'GET',
      path: '/stock/on-hand',
      query: z.object({ branchId: z.string().uuid(), itemId: z.string().uuid().optional() }),
      responses: { 200: z.array(z.object({ itemId: z.string().uuid(), onHand: z.number() })) }
    },
    ledger: {
      method: 'GET',
      path: '/stock/ledger',
      query: z.object({ branchId: z.string().uuid(), itemId: z.string().uuid().optional() }),
      responses: { 200: z.array(stockLedgerSchema) }
    }
  },
  sales: {
    create: {
      method: 'POST',
      path: '/sales',
      body: saleCreateBodySchema,
      responses: { 201: saleInvoiceWithLinesSchema }
    },
    /** Create and pay in one transaction; retrying with the same idempotencyKey returns the same invoice. */
    checkout: {
      method: 'POST',
      path: '/sales/checkout',
      body: saleCreateBodySchema.extend({
        idempotencyKey: z.string().uuid(),
        // Empty for a credit sale (registered customers only).
        payments: z.array(paymentInputSchema).default([])
      }),
      responses: { 200: z.object({ invoice: saleInvoiceWithLinesSchema, receipt: receiptSchema.nullable() }) }
    },
    settle: {
      method: 'POST',
      path: '/sales/:id/settle',
      body: z.object({ payments: z.array(paymentInputSchema).min(1) }),
      responses: { 200: z.object({ invoice: saleInvoiceWithLinesSchema, receipt: receiptSchema }) }
    },
    /** Admin: cancel an unpaid DRAFT invoice and put its stock back. */
    cancel: {
      method: 'POST',
      path: '/sales/:id/cancel',
      body: z.undefined(),
      responses: { 200: saleInvoiceWithLinesSchema }
    },
    list: {
      method: 'GET',
      path: '/sales',
      query: z.object({ branchId: z.string().uuid() }),
      responses: { 200: z.array(saleInvoiceSchema) }
    },
    getById: {
      method: 'GET',
      path: '/sales/:id',
      responses: { 200: saleInvoiceDetailSchema }
    },
    returns: {
      method: 'POST',
      path: '/sales/:id/return',
      body: z.object({
        lines: z
          .array(z.object({ saleLineId: z.string().uuid(), qty: z.number().positive() }))
          .min(1)
          .superRefine(uniqueBy((line) => line.saleLineId, 'Sale line is listed more than once')),
        refundMode: returnRefundModeSchema
      }),
      responses: { 201: returnSchema }
    }
  },
  receipts: {
    getById: {
      method: 'GET',
      path: '/receipts/:id',
      responses: { 200: receiptSchema }
    },
    getByInvoice: {
      method: 'GET',
      path: '/receipts/by-invoice/:invoiceId',
      responses: { 200: z.array(receiptSchema) }
    }
  },
  returns: {
    list: {
      method: 'GET',
      path: '/returns',
      responses: { 200: z.array(returnListItemSchema) }
    },
    getById: {
      method: 'GET',
      path: '/returns/:id',
      responses: { 200: returnDetailSchema }
    }
  },
  reports: {
    salesSummary: {
      method: 'GET',
      path: '/reports/sales-summary',
      query: z.object({ branchId: z.string().uuid() }),
      responses: {
        200: z.object({
          branchId: z.string().uuid(),
          generatedAt: z.string().datetime(),
          /** The business time zone the ranges were worked out in. */
          timezone: z.string(),
          ranges: z.array(reportRangeSchema)
        })
      }
    }
  }
});

export type AppContract = typeof appContract;
