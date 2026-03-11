import { initContract } from '@ts-rest/core';
import { z } from 'zod';

const c = initContract();

const roleSchema = z.enum(['ADMIN', 'CASHIER']);
const paymentModeSchema = z.enum(['CASH', 'CARD', 'WALLET']);
const returnRefundModeSchema = z.enum(['CASH', 'WALLET']);
const invoiceStatusSchema = z.enum(['DRAFT', 'SETTLED', 'PARTIALLY_SETTLED', 'CANCELLED']);
const stockTxnTypeSchema = z.enum(['OPENING', 'ADJUSTMENT_PLUS', 'ADJUSTMENT_MINUS', 'SALE', 'RETURN']);
const walletTxnTypeSchema = z.enum(['TOPUP', 'DEBIT_SALE', 'REFUND_RETURN', 'ADJUSTMENT']);
const taxModeSchema = z.enum(['INCLUSIVE', 'EXCLUSIVE']);

export const moneySchema = z.number().finite();

export const branchSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string()
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

export const userSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  role: roleSchema,
  branchId: z.string().uuid(),
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
  costPrice: moneySchema,
  sellPrice: moneySchema,
  taxMode: taxModeSchema,
  taxRate: z.number().min(0),
  imageUrl: z.string().url().nullable(),
  isActive: z.boolean(),
  createdAt: z.string().datetime()
});

const saleLineInput = z.object({
  itemId: z.string().uuid(),
  qty: z.number().positive(),
  rate: moneySchema,
  discountAmount: moneySchema.default(0),
  taxRate: z.number().min(0)
});

const saleLineSchema = saleLineInput.extend({
  id: z.string().uuid(),
  taxableAmount: moneySchema,
  taxAmount: moneySchema,
  netAmount: moneySchema
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
  subTotal: moneySchema,
  discountTotal: moneySchema,
  taxTotal: moneySchema,
  grandTotal: moneySchema,
  paidTotal: moneySchema,
  status: invoiceStatusSchema,
  createdBy: z.string().uuid(),
  createdByName: z.string(),
  createdAt: z.string().datetime()
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
  salesTotal: moneySchema,
  returnsTotal: moneySchema,
  expensesTotal: moneySchema,
  netSales: moneySchema,
  profit: moneySchema
});

export const appContract = c.router({
  auth: {
    login: {
      method: 'POST',
      path: '/auth/login',
      body: z.object({ username: z.string(), password: z.string() }),
      responses: { 200: z.object({ token: z.string(), userId: z.string().uuid(), username: z.string(), role: roleSchema, branchId: z.string().uuid() }) }
    },
    me: {
      method: 'GET',
      path: '/auth/me',
      responses: { 200: z.object({ userId: z.string().uuid(), username: z.string(), role: roleSchema, branchId: z.string().uuid() }) }
    }
  },
  branches: {
    get: {
      method: 'GET',
      path: '/branches/:id',
      responses: { 200: branchSettingsSchema }
    },
    update: {
      method: 'PATCH',
      path: '/branches/:id',
      body: z.object({
        name: z.string().optional(),
        code: z.string().optional(),
        logoUrl: z.string().nullable().optional(),
        invoicePrefix: z.string().optional(),
        receiptPrefix: z.string().optional(),
        returnPrefix: z.string().optional(),
        invoiceHeader: z.string().nullable().optional(),
        invoiceFooter: z.string().nullable().optional(),
        receiptHeader: z.string().nullable().optional(),
        receiptFooter: z.string().nullable().optional(),
        invoiceCss: z.string().nullable().optional(),
        receiptCss: z.string().nullable().optional()
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
      body: z.object({ branchId: z.string().uuid(), name: z.string(), phone: z.string().optional() }),
      responses: { 201: customerSchema }
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
      body: z.object({ branchId: z.string().uuid(), username: z.string(), password: z.string() }),
      responses: { 201: userSchema }
    },
    update: {
      method: 'PATCH',
      path: '/users/:id',
      body: z.object({
        username: z.string().optional(),
        password: z.string().optional(),
        isActive: z.boolean().optional()
      }),
      responses: { 200: userSchema }
    }
  },
  items: {
    list: {
      method: 'GET',
      path: '/items',
      query: z.object({ activeOnly: z.coerce.boolean().optional() }),
      responses: { 200: z.array(itemSchema) }
    },
    create: {
      method: 'POST',
      path: '/items',
      body: z.object({
        code: z.string(),
        name: z.string(),
        category: z.string().optional(),
        uom: z.string(),
        costPrice: moneySchema.nonnegative().optional(),
        sellPrice: moneySchema.nonnegative(),
        taxMode: taxModeSchema.optional(),
        taxRate: z.number().min(0),
        imageUrl: z.string().url().optional()
      }),
      responses: { 201: itemSchema }
    },
    update: {
      method: 'PATCH',
      path: '/items/:id',
      body: z.object({
        name: z.string().optional(),
        category: z.string().nullable().optional(),
        uom: z.string().optional(),
        costPrice: moneySchema.nonnegative().optional(),
        sellPrice: moneySchema.nonnegative().optional(),
        taxMode: taxModeSchema.optional(),
        taxRate: z.number().min(0).optional(),
        imageUrl: z.string().url().nullable().optional(),
        isActive: z.boolean().optional()
      }),
      responses: { 200: itemSchema }
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
        reason: z.string()
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
      body: z.object({ branchId: z.string().uuid(), customerId: z.string().uuid(), lines: z.array(saleLineInput).min(1) }),
      responses: { 201: saleInvoiceWithLinesSchema }
    },
    settle: {
      method: 'POST',
      path: '/sales/:id/settle',
      body: z.object({ payments: z.array(z.object({ mode: paymentModeSchema, amount: moneySchema.positive(), reference: z.string().optional() })).min(1) }),
      responses: { 200: z.object({ invoice: saleInvoiceWithLinesSchema, receipt: receiptSchema }) }
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
      body: z.object({ lines: z.array(z.object({ saleLineId: z.string().uuid(), qty: z.number().positive() })).min(1), refundMode: returnRefundModeSchema }),
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
          ranges: z.array(reportRangeSchema)
        })
      }
    }
  }
});

export type AppContract = typeof appContract;
