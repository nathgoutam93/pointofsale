// Sales, receipts and returns.
import { z } from 'zod';
import {
  c,
  compositionCategorySchema,
  discountScopeSchema,
  discountTypeSchema,
  emailSchema,
  gstDocumentTypeSchema,
  gstStateCodeSchema,
  gstSupplyTypeSchema,
  invoiceStatusSchema,
  moneySchema,
  pageQuerySchema,
  paymentModeSchema,
  queryBooleanSchema,
  returnRefundModeSchema,
  taxModeSchema,
  taxpayerTypeSchema,
  taxRateSchema,
  uniqueBy
} from './shared.js';

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
  /** taxAmount by kind: CGST + SGST within a state, IGST between states. */
  cgstAmount: moneySchema.default(0),
  sgstAmount: moneySchema.default(0),
  igstAmount: moneySchema.default(0),
  netAmount: moneySchema,
  /** The item's GST details when it was sold. */
  hsnCode: z.string().nullable().default(null),
  uqc: z.string().nullable().default(null),
  supplyType: gstSupplyTypeSchema.default('TAXABLE'),
  discountAllocations: z.array(discountAllocationSchema)
});

/** A return line's refund split into taxable value and tax by kind (amount = taxable + tax). */
const returnLineGstShape = {
  taxableAmount: moneySchema.default(0),
  taxAmount: moneySchema.default(0),
  cgstAmount: moneySchema.default(0),
  sgstAmount: moneySchema.default(0),
  igstAmount: moneySchema.default(0)
};

const returnLineForSaleLineSchema = z.object({
  id: z.string().uuid(),
  returnInvoiceId: z.string().uuid(),
  qty: z.number().positive(),
  amount: moneySchema,
  ...returnLineGstShape
});

const paymentSchema = z.object({
  id: z.string().uuid(),
  invoiceId: z.string().uuid(),
  mode: paymentModeSchema,
  amount: moneySchema,
  /** Cash handed over, when more than the amount; the rest was given back as change. */
  tendered: moneySchema.nullable().optional(),
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
  /** A registered buyer's GSTIN and billing address, as at the sale. */
  buyerGstin: z.string().nullable().default(null),
  buyerAddress: z.string().nullable().default(null),
  reference: z.string().nullable().default(null),
  /** When what is owed is due (the customer's payment terms); null with no terms. */
  dueDate: z.string().datetime().nullable().default(null),
  subTotal: moneySchema,
  discountTotal: moneySchema,
  orderDiscountAmount: moneySchema.default(0),
  taxTotal: moneySchema,
  cgstTotal: moneySchema.default(0),
  sgstTotal: moneySchema.default(0),
  igstTotal: moneySchema.default(0),
  /** What the total was rounded by (business setting); grandTotal includes it. */
  roundOff: moneySchema.default(0),
  grandTotal: moneySchema,
  paidTotal: moneySchema,
  /** Taken off what was owed by returns made before the bill was paid in full (see invoiceDue). */
  creditedTotal: moneySchema.default(0),
  status: invoiceStatusSchema,
  createdBy: z.string().uuid(),
  createdByName: z.string(),
  createdAt: z.string().datetime(),
  /** A cancelled bill: when, by whom and why. */
  cancelledAt: z.string().datetime().nullable().optional(),
  cancelledByName: z.string().nullable().optional(),
  cancelReason: z.string().nullable().optional(),
  taxpayerType: taxpayerTypeSchema.default('REGULAR'),
  documentType: gstDocumentTypeSchema.default('TAX_INVOICE'),
  compositionCategory: compositionCategorySchema.nullable().default(null),
  /** The selling branch's GSTIN and state, and where the goods went, as at the sale. */
  sellerGstin: z.string().nullable().default(null),
  sellerStateCode: z.string().nullable().default(null),
  placeOfSupplyStateCode: z.string().nullable().default(null),
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
  /** totalAmount split into taxable value and tax by kind. */
  taxableTotal: moneySchema.default(0),
  taxTotal: moneySchema.default(0),
  cgstTotal: moneySchema.default(0),
  sgstTotal: moneySchema.default(0),
  igstTotal: moneySchema.default(0),
  /**
   * totalAmount = dueAdjusted + refundAmount: a return first lowers what the customer still owed
   * on the bill, and only the rest is handed back (refundMode).
   */
  dueAdjusted: moneySchema.default(0),
  refundAmount: moneySchema.default(0),
  refundMode: returnRefundModeSchema,
  /** Why the goods came back; who made the return. Null on older returns. */
  reason: z.string().nullable().optional(),
  createdByName: z.string().nullable().optional(),
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
      amount: moneySchema,
      ...returnLineGstShape
    })
  )
});

const saleCreateBodySchema = z.object({
  branchId: z.string().uuid(),
  customerId: z.string().uuid(),
  walkInCustomerName: z.string().trim().optional().nullable(),
  walkInCustomerPhone: z.string().trim().optional().nullable(),
  lines: z.array(saleLineInput).min(1),
  discounts: z.array(discountInputSchema).default([]),
  /** Where the goods go, when shipped to another state. Defaults to the branch's state (sold over the counter). */
  placeOfSupplyStateCode: gstStateCodeSchema.optional(),
  /** The buyer's order or reference number, printed on the bill. */
  reference: z.string().trim().max(40).optional()
});

const paymentInputSchema = z
  .object({
    mode: paymentModeSchema,
    amount: moneySchema.positive(),
    /** Cash only: what the customer handed over, when more than `amount` (the rest is change). */
    tendered: moneySchema.positive().optional(),
    reference: z.string().optional()
  })
  .refine((payment) => payment.tendered === undefined || (payment.mode === 'CASH' && payment.tendered >= payment.amount), {
    message: 'Cash tendered is for cash payments, and at least the amount paid',
    path: ['tendered']
  });

export const salesRoutes = c.router({
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
  /**
   * Admins, and cashiers allowed to: cancel an unpaid DRAFT invoice on the day it was made and
   * put its stock back. Later, the way out is a return (credit note).
   */
  cancel: {
    method: 'POST',
    path: '/sales/:id/cancel',
    body: z.object({ reason: z.string().trim().min(3, 'Say why the bill is cancelled').max(200) }),
    responses: { 200: saleInvoiceWithLinesSchema }
  },
  list: {
    method: 'GET',
    path: '/sales',
    /** A page of the branch's bills, newest first, matching the filters. */
    query: pageQuerySchema.extend({
      branchId: z.string().uuid(),
      /** In the bill number, customer's name or phone, or who made it. */
      search: z.string().trim().max(100).optional(),
      status: invoiceStatusSchema.optional(),
      /** true: only bills with money still owed; false: only those without. */
      owed: queryBooleanSchema.optional(),
      customerId: z.string().uuid().optional()
    }),
    responses: { 200: z.array(saleInvoiceSchema) }
  },
  getById: {
    method: 'GET',
    path: '/sales/:id',
    responses: { 200: saleInvoiceDetailSchema }
  },
  /**
   * Online only: emails the sale's receipt to a customer, laid out with the branch's receipt
   * template. Needs the server's email set up (503 otherwise).
   */
  emailReceipt: {
    method: 'POST',
    path: '/sales/:id/email-receipt',
    body: z.object({ email: emailSchema }),
    responses: { 202: z.object({ sent: z.literal(true) }) }
  },
  returns: {
    method: 'POST',
    path: '/sales/:id/return',
    body: z.object({
      lines: z
        .array(z.object({ saleLineId: z.string().uuid(), qty: z.number().positive() }))
        .min(1)
        .superRefine(uniqueBy((line) => line.saleLineId, 'Sale line is listed more than once')),
      refundMode: returnRefundModeSchema,
      /** Why the goods came back (damaged, wrong size...). */
      reason: z.string().trim().min(3, 'Say why the goods came back').max(200)
    }),
    responses: { 201: returnSchema }
  }
});

export const receiptsRoutes = c.router({
  getById: {
    method: 'GET',
    path: '/receipts/:id',
    responses: { 200: receiptSchema }
  },
  getByInvoice: {
    method: 'GET',
    // The invoice id, or its number URL-encoded (numbers contain '/', e.g. MAIN%2F2627%2F00001).
    path: '/receipts/by-invoice/:invoiceId',
    responses: { 200: z.array(receiptSchema) }
  }
});

export const returnsRoutes = c.router({
  list: {
    method: 'GET',
    path: '/returns',
    /** A page of the branch's returns, newest first. Default: the open register's branch; admins may name any branch they manage. */
    query: pageQuerySchema.extend({
      branchId: z.string().uuid().optional(),
      /** In the return or bill number, or the customer's name. */
      search: z.string().trim().max(100).optional()
    }),
    responses: { 200: z.array(returnListItemSchema) }
  },
  getById: {
    method: 'GET',
    path: '/returns/:id',
    responses: { 200: returnDetailSchema }
  }
});
