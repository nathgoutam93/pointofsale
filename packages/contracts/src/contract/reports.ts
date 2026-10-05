// GST returns, billing, the audit log and reports.
import { z } from 'zod';
import {
  billingCheckoutBodySchema,
  billingCheckoutResponseSchema,
  billingStatusSchema,
  billingSummarySchema
} from '../billing.js';
import { c, calendarDateSchema, compositionCategorySchema, gstinSchema, moneySchema } from './shared.js';
import { registerCashSchema, registerSessionSchema } from './business.js';

/** GET /exports/sales.csv: the sales register (CSV) for a period; every branch the admin manages when no branch is given. */
export const salesExportQuerySchema = z
  .object({ branchId: z.string().uuid().optional(), from: calendarDateSchema, to: calendarDateSchema })
  .refine((query) => query.from <= query.to, { message: 'The start date must be on or before the end date', path: ['to'] });

const reportRangeSchema = z.object({
  label: z.string(),
  startDate: z.string().datetime().nullable(),
  endDate: z.string().datetime().nullable(),
  /** Invoices made in the range, paid or not (not cancelled ones). */
  invoiceCount: z.number().int().nonnegative(),
  /** Sales made in the range including tax, paid or not. A closed range's figures don't change later. */
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
  /** Still owed on unpaid or part-paid (credit) invoices created in the range (part of the sales above). */
  unpaidSales: moneySchema,
  /** Money taken in the range by how it was paid, whenever its bill was made. Wallet payments spend money taken earlier. */
  collections: z
    .object({ cash: moneySchema, card: moneySchema, upi: moneySchema, wallet: moneySchema })
    .default({ cash: 0, card: 0, upi: 0, wallet: 0 })
});

export const auditEventSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  userId: z.string(),
  userName: z.string(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  branchId: z.string().nullable(),
  summary: z.string(),
  details: z.unknown().nullable()
});

/** Sales of one item or category in a period, net of what came back in it (amounts before tax). */
const reportSalesRowSchema = z.object({
  qty: z.number(),
  sales: moneySchema,
  tax: moneySchema,
  cost: moneySchema,
  profit: moneySchema
});

export const reportDetailSchema = z.object({
  from: z.string(),
  to: z.string(),
  timezone: z.string(),
  branchIds: z.array(z.string().uuid()),
  summary: reportRangeSchema,
  items: z.array(reportSalesRowSchema.extend({ itemId: z.string().uuid(), itemName: z.string(), category: z.string().nullable() })),
  categories: z.array(reportSalesRowSchema.extend({ category: z.string().nullable() })),
  /** Bills each user made in the period (with tax) and the credit notes they gave. */
  cashiers: z.array(z.object({ userId: z.string(), name: z.string(), invoices: z.number().int(), sales: moneySchema, returns: moneySchema })),
  /** Discounts given on the period's bills, before tax: on items, and on whole orders. */
  discounts: z.object({ item: moneySchema, order: moneySchema }),
  /** Each register open in the period, with its day-end (Z) figures. */
  registers: z.array(
    registerSessionSchema.merge(registerCashSchema).extend({ branchName: z.string() })
  )
});

/** A GSTIN and a month (from = to) or quarter, as YYYY-MM. */
const gstPeriodQuerySchema = z.object({
  gstin: gstinSchema,
  from: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Use YYYY-MM' }),
  to: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Use YYYY-MM' })
});
const compositionTotalsSchema = z.object({ turnover: z.number(), taxBase: z.number(), cgst: z.number(), sgst: z.number() });
const compositionReturnSchema = z.object({
  gstin: z.string(),
  rows: z.array(
    compositionTotalsSchema.extend({ category: compositionCategorySchema, rate: z.number(), taxableTurnover: z.number() })
  ),
  totals: compositionTotalsSchema,
  /** The business's turnover this financial year (all GSTINs), for the composition limit. */
  yearTurnover: z.number(),
  problems: z.array(z.object({ severity: z.enum(['error', 'warning']), message: z.string() })),
  byQuarter: z.array(compositionTotalsSchema.extend({ quarter: z.number() })).nullable()
});
const gstTaxRowSchema = z.object({ txval: z.number(), iamt: z.number(), camt: z.number(), samt: z.number(), csamt: z.number() });

export const gstRoutes = c.router({
  /** CMP-08: a composition taxpayer's quarter (turnover and tax at the composition rate). */
  cmp08: {
    method: 'GET',
    path: '/gst/cmp08',
    query: gstPeriodQuerySchema,
    responses: { 200: compositionReturnSchema.extend({ from: z.string(), to: z.string() }) }
  },
  /** GSTR-4: a composition taxpayer's financial year (April-March), quarter by quarter. */
  gstr4: {
    method: 'GET',
    path: '/gst/gstr4',
    query: z.object({ gstin: gstinSchema, fy: z.coerce.number().int().min(2017).max(2100) }),
    responses: { 200: compositionReturnSchema.extend({ fy: z.number() }) }
  },
  /** GSTR-3B: Tables 3.1 and 3.2 from the sales, Table 4 (input tax credit) from the purchases recorded. */
  gstr3b: {
    method: 'GET',
    path: '/gst/gstr3b',
    query: gstPeriodQuerySchema,
    responses: {
      200: z.object({
        gstin: z.string(),
        from: z.string(),
        to: z.string(),
        table31: z.object({
          outwardTaxable: gstTaxRowSchema,
          outwardZeroRated: gstTaxRowSchema,
          outwardNilExempt: gstTaxRowSchema,
          inwardReverseCharge: gstTaxRowSchema,
          outwardNonGst: gstTaxRowSchema
        }),
        table32: z.object({ unregistered: z.array(z.object({ pos: z.string(), txval: z.number(), iamt: z.number() })) }),
        table4: z.object({
          itcAvailable: z.object({ iamt: z.number(), camt: z.number(), samt: z.number(), csamt: z.number() }),
          purchases: z.number().int()
        }),
        problems: z.array(z.object({ severity: z.enum(['error', 'warning']), message: z.string() }))
      })
    }
  },
  gstins: {
    method: 'GET',
    path: '/gst/gstins',
    responses: { 200: z.array(z.object({ gstin: z.string(), label: z.string() })) }
  },
  /** GSTR-1 for one GSTIN: a month, or a quarter (Apr-Jun, Jul-Sep, Oct-Dec, Jan-Mar). */
  gstr1: {
    method: 'GET',
    path: '/gst/gstr1',
    query: gstPeriodQuerySchema,
    responses: {
      200: z.object({
        gstin: z.string(),
        from: z.string(),
        to: z.string(),
        /** The file to upload: the GSTR-1 offline tool JSON. */
        json: z.record(z.unknown()),
        /** Errors must be fixed before filing; warnings should be read. */
        problems: z.array(z.object({ severity: z.enum(['error', 'warning']), message: z.string() })),
        summary: z.object({
          invoices: z.number(),
          cancelledInvoices: z.number(),
          creditNotes: z.number(),
          /** Invoices to registered buyers, and credit notes for them, by the buyer's GSTIN (ctin). */
          b2b: z.array(z.object({ ctin: z.string(), inum: z.string(), idt: z.string(), pos: z.string(), val: z.number() }).passthrough()).default([]),
          cdnr: z.array(z.object({ ctin: z.string(), nt_num: z.string(), nt_dt: z.string(), pos: z.string(), val: z.number() }).passthrough()).default([]),
          b2cs: z.array(z.object({ sply_ty: z.string(), pos: z.string(), rt: z.number(), txval: z.number(), iamt: z.number(), camt: z.number(), samt: z.number() })),
          b2cl: z.array(z.object({ pos: z.string(), inum: z.string(), idt: z.string(), val: z.number() }).passthrough()),
          cdnur: z.array(z.object({ nt_num: z.string(), nt_dt: z.string(), pos: z.string(), val: z.number() }).passthrough()),
          nil: z.array(z.object({ sply_ty: z.string(), nil_amt: z.number(), expt_amt: z.number(), ngsup_amt: z.number() })),
          hsn: z.array(z.object({ num: z.number(), hsn_sc: z.string(), desc: z.string(), uqc: z.string(), qty: z.number(), rt: z.number(), txval: z.number(), iamt: z.number(), camt: z.number(), samt: z.number() }).passthrough()),
          documents: z.object({
            invoices: z.array(z.object({ series: z.string(), from: z.string(), to: z.string(), totnum: z.number(), cancel: z.number(), net_issue: z.number() })),
            creditNotes: z.array(z.object({ series: z.string(), from: z.string(), to: z.string(), totnum: z.number(), cancel: z.number(), net_issue: z.number() }))
          })
        })
      })
    }
  }
});

export const billingRoutes = c.router({
  /** Any signed-in user: where the subscription stands (the banner). */
  status: {
    method: 'GET',
    path: '/billing/status',
    responses: { 200: billingStatusSchema }
  },
  /** Admins: plans, prices, usage and invoices. */
  summary: {
    method: 'GET',
    path: '/billing',
    responses: { 200: billingSummarySchema }
  },
  /** Admins: starts paying for a plan; open payPath on the API to pay. */
  checkout: {
    method: 'POST',
    path: '/billing/checkout',
    body: billingCheckoutBodySchema,
    responses: { 201: billingCheckoutResponseSchema }
  },
  /** Admins: an invoice as a printable page. */
  invoice: {
    method: 'GET',
    path: '/billing/invoices/:id',
    pathParams: z.object({ id: z.string().uuid() }),
    responses: { 200: z.object({ number: z.string(), html: z.string() }) }
  }
});

export const auditRoutes = c.router({
  list: {
    method: 'GET',
    path: '/audit',
    query: z.object({
      action: z.string().max(64).optional(),
      /** An entry's createdAt: the page after it. */
      before: z.string().datetime().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50)
    }),
    responses: { 200: z.array(auditEventSchema) }
  }
});

export const reportsRoutes = c.router({
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
  },
  /**
   * Admins: everything an owner asks of a period, for one branch or (without branchId) every
   * branch they manage: the summary, sales by item, category and cashier, discounts given, and
   * the day-end (Z) figures of each register that was open in it. Days are in the business time
   * zone; at most 366 of them.
   */
  detail: {
    method: 'GET',
    path: '/reports/detail',
    query: z.object({
      branchId: z.string().uuid().optional(),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Use YYYY-MM-DD' }),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Use YYYY-MM-DD' })
    }),
    responses: { 200: reportDetailSchema }
  }
});
