// Customers, their credit and wallets.
import { z } from 'zod';
import {
  c,
  calendarDateSchema,
  gstinSchema,
  moneySchema,
  paymentModeSchema,
  requiredText,
  walletTxnTypeSchema
} from './shared.js';

/** A customer's credit: the most they may owe, and the days a credit bill has before it is due. Admins only. */
const customerCreditFields = {
  creditLimit: moneySchema.min(0).nullable().optional(),
  paymentTermsDays: z.number().int().min(0).max(365).nullable().optional()
};

/** Answered (400, with this code) when a cashier's credit sale would take a customer past their credit limit. */
export const CREDIT_LIMIT_EXCEEDED = 'CREDIT_LIMIT_EXCEEDED';

/** What a customer owes, against their limit (see /customers/:id/account). */
export const customerAccountSchema = z.object({
  customerId: z.string().uuid(),
  creditLimit: z.number().nullable(),
  paymentTermsDays: z.number().int().nullable(),
  /** Owed across all their unpaid bills. */
  outstanding: z.number(),
  /** Room left under the limit (never below 0); null with no limit. */
  available: z.number().nullable(),
  /** Owed on bills past their due date. */
  overdue: z.number(),
  overdueBills: z.number().int(),
  oldestDueDate: z.string().datetime().nullable()
});
export type CustomerAccount = z.infer<typeof customerAccountSchema>;

/** Owed amounts by the age of the bill (days since it was made, in the business's time zone). */
const ageingBucketsSchema = z.object({
  days0to30: z.number(),
  days31to60: z.number(),
  days61to90: z.number(),
  over90: z.number(),
  total: z.number()
});

export const customerStatementSchema = z.object({
  customer: z.object({
    id: z.string().uuid(),
    code: z.string(),
    name: z.string(),
    phone: z.string().nullable(),
    gstin: z.string().nullable(),
    address: z.string().nullable(),
    email: z.string().nullable(),
    creditLimit: z.number().nullable()
  }),
  from: z.string(),
  to: z.string(),
  timezone: z.string(),
  /** Owed before `from`. */
  openingBalance: z.number(),
  /** Bills (debit), payments and returns taken off what was owed (credit), oldest first. */
  entries: z.array(
    z.object({
      date: z.string().datetime(),
      kind: z.enum(['BILL', 'PAYMENT', 'RETURN']),
      reference: z.string(),
      detail: z.string().nullable(),
      debit: z.number(),
      credit: z.number(),
      balance: z.number()
    })
  ),
  totals: z.object({ debit: z.number(), credit: z.number() }),
  closingBalance: z.number(),
  /** What is owed now, by age. */
  ageing: ageingBucketsSchema,
  overdue: z.number()
});

/** A registered buyer's details; null (or empty) clears one. */
const customerBuyerFields = {
  gstin: z.preprocess((value) => (value === '' ? null : value), gstinSchema.nullable()).optional(),
  address: z.preprocess((value) => (typeof value === 'string' && !value.trim() ? null : value), z.string().trim().max(300).nullable()).optional(),
  email: z.preprocess((value) => (typeof value === 'string' && !value.trim() ? null : value), z.string().trim().email('Enter a valid email address').nullable()).optional()
};

export const customerSchema = z.object({
  id: z.string().uuid(),
  branchId: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  /** A registered buyer's GSTIN; their state is its first two digits. */
  gstin: z.string().nullable().default(null),
  address: z.string().nullable().default(null),
  email: z.string().nullable().default(null),
  creditLimit: moneySchema.nullable().default(null),
  paymentTermsDays: z.number().int().nullable().default(null),
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
  /** Who made it; null on older entries. */
  createdByName: z.string().nullable().optional(),
  /** A top-up at the counter: how it was paid and the register it was taken on. */
  paymentMode: paymentModeSchema.nullable().optional(),
  registerSessionId: z.string().uuid().nullable().optional(),
  /** Why an admin adjusted the balance. */
  reason: z.string().nullable().optional(),
  createdAt: z.string().datetime()
});

/** How a wallet top-up is paid at the counter. */
export const walletTopupModeSchema = z.enum(['CASH', 'CARD', 'UPI']);

export const customersRoutes = c.router({
  list: {
    method: 'GET',
    path: '/customers',
    query: z.object({ branchId: z.string().uuid() }),
    responses: { 200: z.array(customerSchema) }
  },
  create: {
    method: 'POST',
    path: '/customers',
    body: z.object({
      branchId: z.string().uuid(),
      name: requiredText,
      phone: z.string().optional(),
      ...customerBuyerFields,
      ...customerCreditFields
    }),
    responses: { 201: customerSchema }
  },
  update: {
    method: 'PATCH',
    path: '/customers/:id',
    /** The branch it's done at; defaults to the open register's. Admins may name any branch they manage. */
    query: z.object({ branchId: z.string().uuid().optional() }),
    body: z.object({ name: requiredText.optional(), phone: z.string().nullable().optional(), ...customerBuyerFields, ...customerCreditFields }),
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
    /** The branch it's done at; defaults to the open register's. Admins may name any branch they manage. */
    query: z.object({ branchId: z.string().uuid().optional() }),
    responses: { 200: walletSchema }
  },
  /** What a customer owes against their credit limit, and how much is overdue. */
  account: {
    method: 'GET',
    path: '/customers/:id/account',
    query: z.object({ branchId: z.string().uuid().optional() }),
    responses: { 200: customerAccountSchema }
  },
  /** Bills, payments and returns over a period (dates in the business's time zone), with balances. */
  statement: {
    method: 'GET',
    path: '/customers/:id/statement',
    query: z.object({ branchId: z.string().uuid().optional(), from: calendarDateSchema, to: calendarDateSchema }),
    responses: { 200: customerStatementSchema }
  },
  /** Online: the statement by email. */
  emailStatement: {
    method: 'POST',
    path: '/customers/:id/statement/email',
    query: z.object({ branchId: z.string().uuid().optional() }),
    body: z.object({ from: calendarDateSchema, to: calendarDateSchema, email: z.string().trim().email() }),
    responses: { 202: z.object({ sent: z.literal(true) }) }
  },
  /** Everyone who owes at a branch, by the age of what they owe. */
  ageing: {
    method: 'GET',
    path: '/customers/ageing',
    query: z.object({ branchId: z.string().uuid() }),
    responses: {
      200: z.object({
        timezone: z.string(),
        rows: z.array(
          ageingBucketsSchema.extend({
            customerId: z.string().uuid(),
            code: z.string(),
            name: z.string(),
            phone: z.string().nullable(),
            creditLimit: z.number().nullable(),
            overdue: z.number()
          })
        ),
        totals: ageingBucketsSchema.extend({ overdue: z.number() })
      })
    }
  },
  topupWallet: {
    method: 'POST',
    path: '/customers/:id/wallet/topup',
    /**
     * Money taken at the counter for the customer's wallet, so it needs an open register and
     * is done at its branch (`branchId`, if given, must be that branch). Cash goes in the
     * drawer's expected cash.
     */
    query: z.object({ branchId: z.string().uuid().optional() }),
    body: z.object({ amount: moneySchema.positive(), mode: walletTopupModeSchema, reference: z.string().trim().max(100).optional() }),
    responses: { 200: walletTxnSchema }
  },
  /** Admins only: corrects a wallet balance up (positive) or down (negative), with a reason. No money changes hands. */
  adjustWallet: {
    method: 'POST',
    path: '/customers/:id/wallet/adjust',
    query: z.object({ branchId: z.string().uuid().optional() }),
    body: z.object({
      amount: moneySchema.refine((value) => value !== 0, 'Amount must not be 0'),
      reason: z.string().trim().min(3, 'Say why the balance is being changed').max(200)
    }),
    responses: { 200: walletTxnSchema }
  }
});
