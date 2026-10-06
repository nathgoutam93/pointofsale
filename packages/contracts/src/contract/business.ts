// Business settings, branches, counters and registers.
import { z } from 'zod';
import { scaleBarcodeSchema } from '../barcodes.js';
import { RECEIPT_CSS_MAX_LENGTH, sanitizeReceiptCss } from '../receiptCss.js';
import { receiptTemplateSchema } from '../receiptTemplate.js';
import {
  branchCodeSchema,
  branchSchema,
  c,
  calendarDateSchema,
  compositionCategorySchema,
  customerScopeSchema,
  gstinSchema,
  gstStateCodeSchema,
  moneySchema,
  requiredText,
  taxpayerTypeSchema,
  timeZoneSchema
} from './shared.js';

/** Receipt prefixes become part of receipt numbers. */
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

/** A till in a branch. Each counter has its own register session, cash drawer and document series. */
export const counterSchema = z.object({
  id: z.string().uuid(),
  branchId: z.string().uuid(),
  /** 1, 2, 3... in the branch, never reused: invoices made here are numbered {branch code}/{number}/{YY}/{count}. */
  number: z.number().int().positive(),
  name: z.string(),
  isActive: z.boolean(),
  /**
   * Online: the computer (desktop app device id) that keeps selling on this counter when the
   * server can't be reached; only it may open the counter. null: an ordinary counter.
   */
  fallbackDeviceId: z.string().nullable().default(null)
});

/** Sent by the desktop app with every request: which computer it is (not a secret). */
export const DEVICE_HEADER = 'x-pos-device';
/** The `code` of the 403 a fallback counter's local copy answers for what it can't do offline. */
export const FALLBACK_UNAVAILABLE = 'FALLBACK_UNAVAILABLE';
/** The `code` of the 502 the desktop app answers when it can't reach the online server. */
export const SERVER_UNREACHABLE = 'SERVER_UNREACHABLE';
/**
 * The `code` of the 409 the server answers when a fallback counter's offline sales clash with
 * what it has (a number already used, something they point at missing); `conflicts` lists each
 * as { document, problem } for the person to read. Nothing is added until none are left.
 */
export const FALLBACK_SYNC_CONFLICT = 'FALLBACK_SYNC_CONFLICT';

const counterNameSchema = z.string().trim().min(1).max(40);

export const registerSessionSchema = z.object({
  id: z.string().uuid(),
  branchId: z.string().uuid(),
  counterId: z.string().uuid(),
  counterName: z.string(),
  /** Who opened the register (and runs it until it is closed). */
  openedBy: z.string(),
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

/**
 * Running cash for a register: cash payments and cash wallet top-ups taken on it, cash refunds
 * given, cash paid to suppliers and for expenses from it, cash put in or taken out, and the
 * card and UPI payments and top-ups taken on it (not in the drawer; for checking against
 * settlements).
 */
export const registerCashSchema = z.object({
  cashSales: moneySchema,
  cashTopups: moneySchema,
  cashRefunds: moneySchema,
  cashPaidOut: moneySchema.default(0),
  /** Cash put into the drawer, and taken out of it (not expenses). */
  cashIn: moneySchema.default(0),
  cashOut: moneySchema.default(0),
  /** Expenses paid in cash from the drawer. */
  cashExpenses: moneySchema.default(0),
  expectedCash: moneySchema,
  cardSales: moneySchema,
  upiSales: moneySchema
});

/** A branch's active counters, each with its open register (if any) and its last closed one. */
export const registerSummarySchema = z.object({
  branchId: z.string().uuid(),
  counters: z.array(
    z.object({
      counter: counterSchema,
      current: registerSessionSchema.nullable(),
      lastClosed: registerSessionSchema.nullable()
    })
  )
});

export const branchSettingsSchema = branchSchema.extend({
  logoUrl: z.string().nullable(),
  receiptPrefix: z.string(),
  invoiceHeader: z.string().nullable(),
  invoiceFooter: z.string().nullable(),
  receiptHeader: z.string().nullable(),
  receiptFooter: z.string().nullable(),
  invoiceCss: z.string().nullable(),
  receiptCss: z.string().nullable(),
  /**
   * How this branch's receipts are laid out. Stored as JSON and possibly written by a newer
   * version, so it is read leniently: use resolveReceiptTemplate() rather than this value.
   */
  receiptTemplate: z.unknown().nullable(),
  /** The branch's own GSTIN; when empty, the business GSTIN is used if it is for the same state. */
  gstin: z.string().nullable(),
  /** Where the branch is: the place of supply of an over-the-counter sale. */
  stateCode: z.string().nullable()
});

export const businessSettingsSchema = z.object({
  id: z.string(),
  name: z.string(),
  logoUrl: z.string().nullable(),
  gstNumber: z.string().nullable(),
  cashierMaxDiscountPercent: z.number(),
  customerScope: customerScopeSchema,
  /** IANA zone report periods are worked out in, e.g. Asia/Kolkata. */
  timezone: z.string(),
  /** The GST registration type in force now (see /business/taxpayer-type for history). */
  taxpayerType: taxpayerTypeSchema,
  compositionCategory: compositionCategorySchema.nullable(),
  /** Shortest HSN code accepted on items: 4 (turnover up to ₹5 crore) or 6. */
  hsnMinDigits: z.number().int(),
  /** Days after a sale cashiers may still make a return (0: same day only); null for no limit. Admins aren't limited. */
  returnWindowDays: z.number().int().nullable(),
  /** How each bill's total is rounded. */
  roundOffMode: z.enum(['NONE', 'NEAREST_1', 'NEAREST_050']).default('NONE'),
  /** Admins (and cashiers allowed to) may sell more than the stock count shows. */
  allowNegativeStock: z.boolean().default(false),
  /** How the weighing scale's labels are laid out; null without a scale. */
  scaleBarcode: scaleBarcodeSchema.nullable().default(null),
  /** Registered businesses only: branches with no GSTIN, which can't bill until one is entered or the business turns Unregistered. */
  branchesMissingGstin: z.array(z.object({ id: z.string(), name: z.string() })).default([])
});

export const taxpayerTypeChangeSchema = z.object({
  id: z.string().uuid(),
  taxpayerType: taxpayerTypeSchema,
  compositionCategory: compositionCategorySchema.nullable(),
  effectiveDate: z.string(),
  effectiveFrom: z.string().datetime(),
  createdByName: z.string(),
  createdAt: z.string().datetime()
});

export const taxpayerTypeSummarySchema = z.object({
  /** In force now. effectiveDate is null while the business has never changed type (REGULAR). */
  current: z.object({
    taxpayerType: taxpayerTypeSchema,
    compositionCategory: compositionCategorySchema.nullable(),
    effectiveDate: z.string().nullable()
  }),
  /** A change saved for a later date, not yet in force. */
  scheduled: taxpayerTypeChangeSchema.nullable(),
  /** Every change, newest first. */
  history: z.array(taxpayerTypeChangeSchema)
});

export const businessRoutes = c.router({
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
      gstNumber: gstinSchema.nullable().optional(),
      cashierMaxDiscountPercent: z.number().min(0).max(100).optional(),
      customerScope: customerScopeSchema.optional(),
      timezone: timeZoneSchema.optional(),
      hsnMinDigits: z.union([z.literal(4), z.literal(6)]).optional(),
      returnWindowDays: z.number().int().min(0).max(3650).nullable().optional(),
      roundOffMode: z.enum(['NONE', 'NEAREST_1', 'NEAREST_050']).optional(),
      allowNegativeStock: z.boolean().optional(),
      scaleBarcode: scaleBarcodeSchema.nullable().optional()
    }),
    responses: { 200: businessSettingsSchema }
  },
  taxpayerType: {
    method: 'GET',
    path: '/business/taxpayer-type',
    responses: { 200: taxpayerTypeSummarySchema }
  },
  changeTaxpayerType: {
    method: 'POST',
    path: '/business/taxpayer-type',
    body: z
      .object({
        taxpayerType: taxpayerTypeSchema,
        compositionCategory: compositionCategorySchema.nullable().optional(),
        /** Today or later, in the business time zone. */
        effectiveDate: calendarDateSchema
      })
      .refine((body) => (body.taxpayerType === 'COMPOSITION') === !!body.compositionCategory, {
        message: 'A composition taxpayer needs a category, and a regular one must not have one',
        path: ['compositionCategory']
      }),
    responses: { 201: taxpayerTypeSummarySchema }
  },
  cancelTaxpayerTypeChange: {
    method: 'DELETE',
    path: '/business/taxpayer-type/:id',
    body: z.undefined(),
    responses: { 200: taxpayerTypeSummarySchema }
  }
});

export const branchesRoutes = c.router({
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
      code: branchCodeSchema
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
      /** Invoices and credit notes made after a change are numbered in the new code's series. */
      code: branchCodeSchema.optional(),
      logoUrl: z.string().nullable().optional(),
      receiptPrefix: documentCodeSchema.optional(),
      invoiceHeader: z.string().nullable().optional(),
      invoiceFooter: z.string().nullable().optional(),
      receiptHeader: z.string().nullable().optional(),
      receiptFooter: z.string().nullable().optional(),
      invoiceCss: receiptCssSchema.nullable().optional(),
      receiptCss: receiptCssSchema.nullable().optional(),
      /** null goes back to the classic layout on the paper the old CSS asked for. */
      receiptTemplate: receiptTemplateSchema.nullable().optional(),
      gstin: gstinSchema.nullable().optional(),
      stateCode: gstStateCodeSchema.nullable().optional()
    }),
    responses: { 200: branchSettingsSchema }
  }
});

export const countersRoutes = c.router({
  list: {
    method: 'GET',
    path: '/branches/:branchId/counters',
    query: z.object({ includeInactive: z.enum(['true', 'false']).optional() }),
    responses: { 200: z.array(counterSchema) }
  },
  create: {
    method: 'POST',
    path: '/branches/:branchId/counters',
    body: z.object({ name: counterNameSchema }),
    responses: { 201: counterSchema }
  },
  update: {
    method: 'PATCH',
    path: '/counters/:id',
    body: z
      .object({ name: counterNameSchema.optional(), isActive: z.boolean().optional() })
      .refine((body) => body.name !== undefined || body.isActive !== undefined, 'Nothing to update'),
    responses: { 200: counterSchema }
  },
  /**
   * Online, admins, from the desktop app on that computer: makes this the branch's fallback
   * counter, bound to `deviceId` (any other fallback counter of the branch stops being one).
   * Answers the key that computer keeps, shown only here.
   */
  setFallback: {
    method: 'POST',
    path: '/counters/:id/fallback',
    body: z.object({ deviceId: z.string().uuid() }),
    responses: { 200: z.object({ key: z.string(), counter: counterSchema }) }
  },
  /** Online, admins: an ordinary counter again; its computer's key stops working. */
  clearFallback: {
    method: 'DELETE',
    path: '/counters/:id/fallback',
    responses: { 200: counterSchema }
  }
});

export const registersRoutes = c.router({
  open: {
    method: 'POST',
    path: '/registers/open',
    body: z.object({
      branchId: z.string().uuid(),
      /** Required when the branch has more than one active counter. */
      counterId: z.string().uuid().optional(),
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
  },
  /**
   * Admins: close a register someone else left open (a cashier who went home), at a branch they
   * manage. `closingBalance` is the cash counted, or null when nobody counted it.
   */
  closeOther: {
    method: 'POST',
    path: '/registers/:id/close',
    body: z.object({ closingBalance: moneySchema.nonnegative().nullable() }),
    responses: {
      200: registerSessionSchema.merge(registerCashSchema.omit({ expectedCash: true }))
    }
  }
});
