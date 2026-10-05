// Items, stock, purchases and transfers between branches.
import { z } from 'zod';
import {
  branchSchema,
  c,
  calendarDateSchema,
  gstinSchema,
  gstSupplyTypeSchema,
  gstUqcSchema,
  hsnCodeSchema,
  moneySchema,
  pageQuerySchema,
  requiredText,
  stockTransferStatusSchema,
  stockTxnTypeSchema,
  taxModeSchema,
  taxRateSchema,
  uniqueBy
} from './shared.js';

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
  /** HSN (goods) or SAC (services) code; null until the admin enters it. */
  hsnCode: z.string().nullable(),
  /** GST unit quantity code of the base unit; null when the unit couldn't be matched. */
  uqc: z.string().nullable(),
  supplyType: gstSupplyTypeSchema,
  /** /uploads/… (or, saved by older versions, a full address). */
  imageUrl: z.string().nullable(),
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

/** A barcode an item is scanned by besides its code; `saleUom` when it sells a sale unit (a box). */
const itemBarcodeInputSchema = z.object({
  barcode: z.string().trim().min(3, 'A barcode has at least 3 characters').max(64),
  saleUom: z.string().trim().min(1).nullable().optional()
});
const itemBarcodeListSchema = z
  .array(itemBarcodeInputSchema)
  .max(50)
  .superRefine(uniqueBy((entry) => entry.barcode.toLowerCase(), 'A barcode is listed more than once'));

export const itemWithSaleUomsSchema = itemSchema.extend({
  saleUoms: z.array(itemSaleUomSchema),
  barcodes: z.array(z.object({ id: z.string().uuid(), barcode: z.string(), saleUom: z.string().nullable() })).default([])
});

const saleUomInputListSchema = z
  .array(itemSaleUomInputSchema)
  .superRefine(uniqueBy((entry) => entry.uom.toUpperCase(), 'Sale unit is listed more than once'));

/** A branch's own price for one of an item's units (the base unit or a sale unit). */
const itemBranchPriceInputSchema = z.object({
  uom: requiredText,
  sellPrice: moneySchema.nonnegative(),
  /** Defaults to the item's MRP for that unit. */
  mrp: moneySchema.nonnegative().optional()
});

const itemBranchPriceSchema = z.object({
  branchId: z.string().uuid(),
  itemId: z.string().uuid(),
  uom: z.string(),
  sellPrice: moneySchema,
  mrp: moneySchema,
  updatedAt: z.string().datetime()
});

const purchaseLineInputSchema = z.object({
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
  createdByName: z.string(),
  createdAt: z.string().datetime(),
  lines: z.array(
    purchaseLineInputSchema.extend({
      id: z.string().uuid(),
      amount: moneySchema,
      cgstAmount: moneySchema.default(0),
      sgstAmount: moneySchema.default(0),
      igstAmount: moneySchema.default(0),
      item: z.object({ code: z.string(), name: z.string(), uom: z.string() })
    })
  )
});

const stockTransferSchema = z.object({
  id: z.string().uuid(),
  transferNo: z.string(),
  fromBranchId: z.string().uuid(),
  toBranchId: z.string().uuid(),
  fromBranch: branchSchema,
  toBranch: branchSchema,
  status: stockTransferStatusSchema,
  note: z.string().nullable(),
  createdByName: z.string(),
  createdAt: z.string().datetime(),
  closedByName: z.string().nullable(),
  closedAt: z.string().datetime().nullable(),
  lines: z.array(
    z.object({
      id: z.string().uuid(),
      itemId: z.string().uuid(),
      qty: z.number().positive(),
      unitCost: moneySchema,
      item: z.object({ code: z.string(), name: z.string(), uom: z.string() })
    })
  )
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

export const itemsRoutes = c.router({
  list: {
    method: 'GET',
    path: '/items',
    // Query strings arrive as text; z.coerce.boolean() would turn "false" into true.
    query: z.object({
      activeOnly: z
        .union([z.boolean(), z.enum(['true', 'false'])])
        .transform((value) => value === true || value === 'true')
        .optional(),
      /** Prices as sold at this branch: its own prices where it has them, else the item's. */
      branchId: z.string().uuid().optional()
    }),
    responses: { 200: z.array(itemWithSaleUomsSchema) }
  },
  /** Admin: every branch's own prices for an item. */
  branchPrices: {
    method: 'GET',
    path: '/items/:id/branch-prices',
    responses: { 200: z.array(itemBranchPriceSchema) }
  },
  /** Admin: replace one branch's own prices for an item; an empty list goes back to the item's prices. */
  setBranchPrices: {
    method: 'PUT',
    path: '/items/:id/branch-prices',
    body: z.object({
      branchId: z.string().uuid(),
      prices: z
        .array(itemBranchPriceInputSchema)
        .superRefine(uniqueBy((entry) => entry.uom.toUpperCase(), 'Unit is listed more than once'))
    }),
    responses: { 200: z.array(itemBranchPriceSchema) }
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
      barcodes: itemBarcodeListSchema.optional(),
      taxMode: taxModeSchema.optional(),
      taxRate: taxRateSchema,
      hsnCode: hsnCodeSchema.nullable().optional(),
      /** Defaults to the UQC the unit name suggests (PCS, KGS...). */
      uqc: gstUqcSchema.nullable().optional(),
      /** Defaults from the tax rate: TAXABLE above 0%, else NIL_RATED. */
      supplyType: gstSupplyTypeSchema.optional(),
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
      /** Replaces the item's barcodes; an empty list clears them. */
      barcodes: itemBarcodeListSchema.optional(),
      taxMode: taxModeSchema.optional(),
      taxRate: taxRateSchema.optional(),
      hsnCode: hsnCodeSchema.nullable().optional(),
      uqc: gstUqcSchema.nullable().optional(),
      supplyType: gstSupplyTypeSchema.optional(),
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
});

export const stockRoutes = c.router({
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
    /** A page of the movements, newest first. */
    query: pageQuerySchema.extend({ branchId: z.string().uuid(), itemId: z.string().uuid().optional() }),
    responses: { 200: z.array(stockLedgerSchema) }
  }
});

export const purchasesRoutes = c.router({
  /** Admin: goods received from a supplier at a branch. */
  create: {
    method: 'POST',
    path: '/purchases',
    body: z.object({
      branchId: z.string().uuid(),
      supplierName: requiredText,
      supplierGstin: gstinSchema.optional(),
      supplierInvoiceNo: z.string().trim().max(32).optional(),
      supplierInvoiceDate: calendarDateSchema.optional(),
      note: z.string().trim().max(500).optional(),
      lines: z
        .array(purchaseLineInputSchema)
        .min(1)
        .max(500)
        .superRefine(uniqueBy((entry) => entry.itemId, 'Item is listed more than once'))
    }),
    responses: { 201: purchaseSchema }
  },
  list: {
    method: 'GET',
    path: '/purchases',
    query: z.object({ branchId: z.string().uuid() }),
    responses: { 200: z.array(purchaseSchema) }
  }
});

export const transfersRoutes = c.router({
  /** Admin: send stock to another branch. It leaves this branch now and arrives when received. */
  create: {
    method: 'POST',
    path: '/stock-transfers',
    body: z
      .object({
        fromBranchId: z.string().uuid(),
        toBranchId: z.string().uuid(),
        note: z.string().trim().max(500).optional(),
        lines: z
          .array(z.object({ itemId: z.string().uuid(), qty: z.number().positive() }))
          .min(1)
          .max(500)
          .superRefine(uniqueBy((entry) => entry.itemId, 'Item is listed more than once'))
      })
      .refine((body) => body.fromBranchId !== body.toBranchId, {
        message: 'Choose a different branch to send to',
        path: ['toBranchId']
      }),
    responses: { 201: stockTransferSchema }
  },
  /**
   * Who may send transfers: every branch of the business, to send to (a cashier may send to a
   * branch they don't work at).
   */
  destinations: {
    method: 'GET',
    path: '/stock-transfers/destinations',
    responses: { 200: z.array(z.object({ id: z.string().uuid(), name: z.string(), code: z.string() })) }
  },
  /** Transfers sent from or to a branch, newest first. */
  list: {
    method: 'GET',
    path: '/stock-transfers',
    query: z.object({ branchId: z.string().uuid() }),
    responses: { 200: z.array(stockTransferSchema) }
  },
  /** Admin at the receiving branch: take the stock in. */
  receive: {
    method: 'POST',
    path: '/stock-transfers/:id/receive',
    body: z.undefined(),
    responses: { 200: stockTransferSchema }
  },
  /** Admin at the sending branch: call it back while in transit; the stock returns. */
  cancel: {
    method: 'POST',
    path: '/stock-transfers/:id/cancel',
    body: z.undefined(),
    responses: { 200: stockTransferSchema }
  }
});
