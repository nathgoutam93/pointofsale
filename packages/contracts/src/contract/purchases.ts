// Purchases from suppliers, goods sent back to them (debit notes), and supplier accounts.
import { z } from 'zod';
import { batchInputSchema } from './inventory.js';
import { c, calendarDateSchema, gstinSchema, moneySchema, pageQuerySchema, requiredText, supplierPaymentModeSchema, taxRateSchema, uniqueBy } from './shared.js';

/** For items that track batches: the batch it comes in, and its expiry date. */
const purchaseLineInputSchema = batchInputSchema.extend({
  itemId: z.string().uuid(),
  /** In the item's base unit. */
  qty: z.number().positive(),
  /** Per base unit, before tax. */
  unitCost: moneySchema.nonnegative(),
  /** GST the supplier charged; defaults to the item's rate (0 from a supplier without a GSTIN). */
  taxRate: taxRateSchema.optional()
});

const purchaseSchema = z.object({
  id: z.string().uuid(),
  purchaseNo: z.string(),
  branchId: z.string().uuid(),
  supplierId: z.string().uuid().nullable().optional(),
  supplierName: z.string(),
  supplierGstin: z.string().nullable(),
  supplierInvoiceNo: z.string().nullable(),
  supplierInvoiceDate: z.string().nullable(),
  note: z.string().nullable(),
  totalCost: moneySchema,
  /** GST charged by the supplier, by kind, and whether it counts as input tax credit. */
  buyerGstin: z.string().nullable().optional(),
  taxTotal: moneySchema.default(0),
  cgstTotal: moneySchema.default(0),
  sgstTotal: moneySchema.default(0),
  igstTotal: moneySchema.default(0),
  itcEligible: z.boolean().default(false),
  /** What is owed for it (amount plus GST), and when it is due (YYYY-MM-DD). */
  grandTotal: moneySchema.default(0),
  dueDate: z.string().nullable().optional(),
  /** Recorded before supplier accounts existed: counted as paid. */
  settledBeforeAccounts: z.boolean().default(false),
  createdByName: z.string(),
  createdAt: z.string().datetime(),
  lines: z.array(
    purchaseLineInputSchema.extend({
      id: z.string().uuid(),
      amount: moneySchema,
      cgstAmount: moneySchema.default(0),
      sgstAmount: moneySchema.default(0),
      igstAmount: moneySchema.default(0),
      item: z.object({ code: z.string(), name: z.string(), uom: z.string() }),
      batch: z.object({ batchNo: z.string(), expiryDate: z.string().nullable() }).nullable().optional()
    })
  )
});

/** Goods sent back to a purchase's supplier: a debit note. */
export const purchaseReturnSchema = z.object({
  id: z.string().uuid(),
  returnNo: z.string(),
  purchaseId: z.string().uuid(),
  purchaseNo: z.string(),
  branchId: z.string().uuid(),
  supplierId: z.string().uuid().nullable(),
  supplierName: z.string(),
  reason: z.string(),
  taxableTotal: moneySchema,
  cgstTotal: moneySchema,
  sgstTotal: moneySchema,
  igstTotal: moneySchema,
  taxTotal: moneySchema,
  totalAmount: moneySchema,
  /** Its GST is taken off input tax credit (the purchase's was claimed). */
  itcReversed: z.boolean(),
  createdByName: z.string(),
  createdAt: z.string().datetime(),
  lines: z.array(
    z.object({
      id: z.string().uuid(),
      purchaseLineId: z.string().uuid(),
      itemId: z.string().uuid(),
      item: z.object({ code: z.string(), name: z.string(), uom: z.string() }),
      qty: z.number(),
      amount: moneySchema,
      taxRate: z.number(),
      cgstAmount: moneySchema,
      sgstAmount: moneySchema,
      igstAmount: moneySchema
    })
  )
});

/** A purchase with what has gone back of each line, and its returns. */
const purchaseDetailSchema = purchaseSchema.extend({
  lines: z.array(purchaseSchema.shape.lines.element.extend({ returnedQty: z.number() })),
  returns: z.array(purchaseReturnSchema)
});

export const supplierSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  gstin: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  /** Days after the supplier's invoice date a purchase is due; null: due at once. */
  paymentTermsDays: z.number().int().nullable(),
  isActive: z.boolean(),
  /** Owed to them now (purchases less returns and payments), and how much of it is overdue. */
  balance: moneySchema,
  overdue: moneySchema
});

const supplierInputSchema = z.object({
  name: requiredText.pipe(z.string().max(120)),
  gstin: gstinSchema.nullable().optional(),
  phone: z.string().trim().max(20).nullable().optional(),
  email: z.string().trim().toLowerCase().email().max(254).nullable().optional(),
  address: z.string().trim().max(500).nullable().optional(),
  paymentTermsDays: z.number().int().min(0).max(365).nullable().optional()
});

export const supplierPaymentSchema = z.object({
  id: z.string().uuid(),
  supplierId: z.string().uuid(),
  branchId: z.string().uuid(),
  amount: moneySchema,
  mode: supplierPaymentModeSchema,
  reference: z.string().nullable(),
  note: z.string().nullable(),
  /** Paid in cash from this register's drawer. */
  registerSessionId: z.string().uuid().nullable(),
  createdByName: z.string(),
  createdAt: z.string().datetime()
});

/** A supplier's account: what is owed, the bills not yet paid (oldest paid first), and every entry with the running balance. */
export const supplierAccountSchema = z.object({
  supplier: supplierSchema,
  openBills: z.array(
    z.object({
      purchaseId: z.string().uuid(),
      purchaseNo: z.string(),
      supplierInvoiceNo: z.string().nullable(),
      date: z.string(),
      dueDate: z.string().nullable(),
      total: moneySchema,
      outstanding: moneySchema,
      overdue: z.boolean()
    })
  ),
  entries: z.array(
    z.object({
      kind: z.enum(['PURCHASE', 'RETURN', 'PAYMENT']),
      id: z.string().uuid(),
      reference: z.string(),
      date: z.string().datetime(),
      /** What it added to the amount owed (purchases) or took off it (returns, payments). */
      amount: moneySchema,
      balance: moneySchema
    })
  )
});
export type SupplierAccount = z.infer<typeof supplierAccountSchema>;

export const purchasesRoutes = c.router({
  /** Goods received from a supplier at a branch. */
  create: {
    method: 'POST',
    path: '/purchases',
    body: z
      .object({
        branchId: z.string().uuid(),
        /** The supplier; or a name, for a supplier found or added by it. */
        supplierId: z.string().uuid().optional(),
        supplierName: requiredText.pipe(z.string().max(120)).optional(),
        supplierGstin: gstinSchema.optional(),
        supplierInvoiceNo: z.string().trim().max(32).optional(),
        supplierInvoiceDate: calendarDateSchema.optional(),
        note: z.string().trim().max(500).optional(),
        lines: z
          .array(purchaseLineInputSchema)
          .min(1)
          .max(500)
          .superRefine(uniqueBy((entry) => `${entry.itemId}:${entry.batchNo?.toUpperCase() ?? ''}`, 'Item is listed more than once in the same batch'))
      })
      .refine((body) => body.supplierId || body.supplierName, { message: 'Choose a supplier', path: ['supplierId'] }),
    responses: { 201: purchaseSchema }
  },
  list: {
    method: 'GET',
    path: '/purchases',
    query: z.object({ branchId: z.string().uuid(), supplierId: z.string().uuid().optional() }),
    responses: { 200: z.array(purchaseSchema) }
  },
  get: {
    method: 'GET',
    path: '/purchases/:id',
    pathParams: z.object({ id: z.string().uuid() }),
    responses: { 200: purchaseDetailSchema }
  },
  /** Send goods back to the purchase's supplier: they leave the branch's stock. */
  createReturn: {
    method: 'POST',
    path: '/purchases/:id/returns',
    pathParams: z.object({ id: z.string().uuid() }),
    body: z.object({
      lines: z
        .array(z.object({ purchaseLineId: z.string().uuid(), qty: z.number().positive() }))
        .min(1)
        .max(500)
        .superRefine(uniqueBy((entry) => entry.purchaseLineId, 'A purchase line is listed more than once')),
      reason: z.string().trim().min(3, 'Say why the goods are going back').max(200)
    }),
    responses: { 201: purchaseReturnSchema }
  },
  /** A branch's purchase returns, newest first. */
  listReturns: {
    method: 'GET',
    path: '/purchase-returns',
    query: pageQuerySchema.extend({ branchId: z.string().uuid() }),
    responses: { 200: z.array(purchaseReturnSchema) }
  }
});

export const suppliersRoutes = c.router({
  list: {
    method: 'GET',
    path: '/suppliers',
    query: z.object({ includeInactive: z.enum(['true', 'false']).optional() }),
    responses: { 200: z.array(supplierSchema) }
  },
  create: {
    method: 'POST',
    path: '/suppliers',
    body: supplierInputSchema,
    responses: { 201: supplierSchema }
  },
  update: {
    method: 'PATCH',
    path: '/suppliers/:id',
    pathParams: z.object({ id: z.string().uuid() }),
    body: supplierInputSchema.partial().extend({ isActive: z.boolean().optional() }),
    responses: { 200: supplierSchema }
  },
  account: {
    method: 'GET',
    path: '/suppliers/:id/account',
    pathParams: z.object({ id: z.string().uuid() }),
    responses: { 200: supplierAccountSchema }
  },
  /** Money paid to a supplier. Cash from the drawer needs this user's open register at the branch. */
  pay: {
    method: 'POST',
    path: '/suppliers/:id/payments',
    pathParams: z.object({ id: z.string().uuid() }),
    body: z
      .object({
        branchId: z.string().uuid(),
        amount: moneySchema.positive(),
        mode: supplierPaymentModeSchema,
        /** Cash taken from this user's register at the branch (it lowers the cash expected at close). */
        fromDrawer: z.boolean().default(false),
        reference: z.string().trim().max(64).optional(),
        note: z.string().trim().max(500).optional()
      })
      .refine((body) => !body.fromDrawer || body.mode === 'CASH', { message: 'Only cash comes from the drawer', path: ['fromDrawer'] }),
    responses: { 201: supplierPaymentSchema }
  }
});
