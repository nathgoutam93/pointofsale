// Items, stock and transfers between branches.
import { z } from 'zod';
import {
  branchSchema,
  c,
  calendarDateSchema,
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
  /** Null for users who may not see costs (only admins and those who adjust stock or record purchases do). */
  costPrice: moneySchema.nullable(),
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
  /** Stock is kept by batch with expiry dates: sold earliest expiry first, never expired. */
  tracksBatches: z.boolean().default(false),
  /** A size/colour variant: its product, and its values of the product's options. */
  groupId: z.string().uuid().nullable().default(null),
  option1: z.string().nullable().default(null),
  option2: z.string().nullable().default(null),
  createdAt: z.string().datetime()
});

/** A product sold in sizes and/or colours; each combination is an item of its own. */
export const itemGroupSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  option1Name: z.string(),
  option2Name: z.string().nullable(),
  /** The options' values in the order given: the picker's rows and columns. */
  option1Values: z.array(z.string()).default([]),
  option2Values: z.array(z.string()).default([])
});

/** An item's stock at a branch, with its reorder level there (null: not watched). */
export const onHandSchema = z.object({
  itemId: z.string().uuid(),
  onHand: z.number(),
  reorderLevel: z.number().nullable().default(null),
  reorderQty: z.number().nullable().default(null)
});

/** An item running low at a branch. */
export const lowStockSchema = z.object({
  itemId: z.string().uuid(),
  itemCode: z.string(),
  itemName: z.string(),
  category: z.string().nullable(),
  uom: z.string(),
  onHand: z.number(),
  reorderLevel: z.number(),
  reorderQty: z.number().nullable()
});

/** The batch stock comes in to or goes out of, for items that track batches. */
export const batchInputSchema = z.object({
  batchNo: z.string().trim().min(1).max(32).optional(),
  /** The last day it may be sold. */
  expiryDate: calendarDateSchema.optional()
});

/** A batch's stock at a branch. */
export const batchStockSchema = z.object({
  batchId: z.string().uuid(),
  itemId: z.string().uuid(),
  itemCode: z.string(),
  itemName: z.string(),
  batchNo: z.string(),
  expiryDate: z.string().nullable(),
  qty: z.number(),
  /** Past its expiry date: it can't be sold. */
  expired: z.boolean()
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
  barcodes: z.array(z.object({ id: z.string().uuid(), barcode: z.string(), saleUom: z.string().nullable() })).default([]),
  group: itemGroupSchema.nullable().default(null)
});

/** An option's values: at most 30, each named once (any case). */
const optionValuesSchema = z
  .array(z.string().trim().min(1).max(20))
  .min(1)
  .max(30)
  .superRefine(uniqueBy((value) => value.toLowerCase(), 'A value is listed more than once'));

export const itemGroupDetailSchema = itemGroupSchema.extend({
  items: z.array(
    z.object({ id: z.string().uuid(), code: z.string(), name: z.string(), option1: z.string(), option2: z.string().nullable(), sellPrice: moneySchema, isActive: z.boolean() })
  )
});

/**
 * Item import: the template's columns, in order. A spreadsheet's header row names them (any
 * case); others are ignored. Fields marked * are needed for a new item.
 */
export const ITEM_IMPORT_COLUMNS = [
  { field: 'code', header: 'Code', note: '* Matches an item already there, which is updated' },
  { field: 'name', header: 'Name', note: '* for new items' },
  { field: 'category', header: 'Category', note: '' },
  { field: 'unit', header: 'Unit', note: '* for new items: PCS, KG, LTR...' },
  { field: 'sellPrice', header: 'Selling price', note: '* for new items' },
  { field: 'mrp', header: 'MRP', note: 'With all taxes' },
  { field: 'costPrice', header: 'Cost price', note: 'Before GST' },
  { field: 'gstRate', header: 'GST %', note: '* for new items: 0, 5, 12, 18, 28...' },
  { field: 'priceIncludesGst', header: 'Price includes GST', note: 'Yes (default) or No' },
  { field: 'hsnCode', header: 'HSN', note: '' },
  { field: 'barcodes', header: 'Barcodes', note: 'Several split by |' },
  { field: 'tracksBatches', header: 'Batches and expiry', note: 'Yes or No (default)' },
  { field: 'openingStock', header: 'Opening stock', note: 'New items, at the branch chosen' },
  { field: 'batchNo', header: 'Batch', note: 'For opening stock of items kept by batch' },
  { field: 'expiryDate', header: 'Expiry date', note: 'YYYY-MM-DD' },
  { field: 'reorderLevel', header: 'Reorder level', note: 'At the branch chosen' },
  { field: 'reorderQty', header: 'Order quantity', note: 'At the branch chosen' },
  { field: 'product', header: 'Product', note: 'Variants: the product they belong to' },
  { field: 'size', header: 'Size', note: 'Variants: needed with Product' },
  { field: 'colour', header: 'Colour', note: 'Variants: optional' }
] as const;
export type ItemImportField = (typeof ITEM_IMPORT_COLUMNS)[number]['field'];

const importCellSchema = z.string().max(500).nullable().optional();
export const itemImportRowSchema = z
  .object({
    /** The spreadsheet's row number, for the errors. */
    row: z.number().int().positive(),
    ...(Object.fromEntries(ITEM_IMPORT_COLUMNS.map((column) => [column.field, importCellSchema])) as Record<ItemImportField, typeof importCellSchema>)
  })
  .strict();

export const itemImportResultSchema = z.object({
  /** False when it was only checked, or had errors: nothing was saved. */
  applied: z.boolean(),
  created: z.number().int(),
  updated: z.number().int(),
  errors: z.array(z.object({ row: z.number().int(), message: z.string() })),
  warnings: z.array(z.object({ row: z.number().int(), message: z.string() }))
});

export const itemGroupsRoutes = c.router({
  /** Products with variants, each with its items. */
  list: {
    method: 'GET',
    path: '/item-groups',
    responses: { 200: z.array(itemGroupDetailSchema) }
  },
  /**
   * Item managers: a product and an item for each combination of its options' values (sizes
   * × colours), coded PREFIX-VALUE1-VALUE2 and named "Name Value1 / Value2", all at one price.
   */
  create: {
    method: 'POST',
    path: '/item-groups',
    body: z
      .object({
        name: requiredText.max(80),
        codePrefix: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9-]+$/, 'Letters, digits and dashes only'),
        category: z.string().optional(),
        uom: requiredText,
        option1Name: requiredText.max(20),
        option1Values: optionValuesSchema,
        option2Name: z.string().trim().min(1).max(20).optional(),
        option2Values: optionValuesSchema.optional(),
        costPrice: moneySchema.nonnegative().optional(),
        sellPrice: moneySchema.nonnegative(),
        mrp: moneySchema.nonnegative().optional(),
        taxMode: taxModeSchema.optional(),
        taxRate: taxRateSchema,
        hsnCode: hsnCodeSchema.nullable().optional(),
        supplyType: gstSupplyTypeSchema.optional(),
        tracksBatches: z.boolean().optional()
      })
      .refine((body) => !body.option2Name === !body.option2Values, { message: 'Name the second option and give its values', path: ['option2Values'] })
      .refine((body) => body.option1Values.length * (body.option2Values?.length ?? 1) <= 200, { message: 'At most 200 combinations', path: ['option1Values'] }),
    responses: { 201: itemGroupDetailSchema }
  },
  /** Item managers: more values (a new size or colour); the new combinations copy the product's first item. */
  addValues: {
    method: 'POST',
    path: '/item-groups/:id/values',
    pathParams: z.object({ id: z.string().uuid() }),
    body: z
      .object({ option1Values: optionValuesSchema.optional(), option2Values: optionValuesSchema.optional() })
      .refine((body) => body.option1Values || body.option2Values, { message: 'Give the new values' }),
    responses: { 200: itemGroupDetailSchema }
  },
  /** Item managers: one price (and MRP) for every variant of the product. */
  setPrices: {
    method: 'PATCH',
    path: '/item-groups/:id/prices',
    pathParams: z.object({ id: z.string().uuid() }),
    body: z.object({ sellPrice: moneySchema.nonnegative(), mrp: moneySchema.nonnegative().optional() }),
    responses: { 200: itemGroupDetailSchema }
  }
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
      /** Null for users who may not see costs. */
      unitCost: moneySchema.nullable(),
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
  /** Null for users who may not see costs. */
  costPrice: moneySchema.nonnegative().nullable(),
  reason: z.string().nullable(),
  referenceType: z.string().nullable(),
  referenceId: z.string().nullable(),
  batchId: z.string().uuid().nullable().optional(),
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
  /**
   * Item managers: items from a spreadsheet (as text cells). Every row is checked first; with
   * no errors and dryRun false, all are saved together: new codes created, existing ones
   * updated (blank cells left as they are), opening stock and reorder levels at the branch.
   */
  import: {
    method: 'POST',
    path: '/items/import',
    body: z.object({
      branchId: z.string().uuid(),
      dryRun: z.boolean().default(true),
      rows: z.array(itemImportRowSchema).min(1).max(5000)
    }),
    responses: { 200: itemImportResultSchema }
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
      imageUrl: z.string().optional(),
      tracksBatches: z.boolean().optional()
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
      isActive: z.boolean().optional(),
      tracksBatches: z.boolean().optional()
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
    body: batchInputSchema.extend({
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
    body: batchInputSchema.extend({
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
    /** For items kept by batch: the batch (stock out without one goes earliest expiry first). */
    body: batchInputSchema.extend({
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
    responses: { 200: z.array(onHandSchema) }
  },
  /** Stock changers: the level at which an item counts as low at a branch, and how much to order then. Null clears. */
  setReorderLevel: {
    method: 'PUT',
    path: '/stock/reorder-level',
    body: z.object({
      branchId: z.string().uuid(),
      itemId: z.string().uuid(),
      reorderLevel: z.number().min(0).max(1_000_000_000).nullable(),
      reorderQty: z.number().positive().max(1_000_000_000).nullable()
    }),
    responses: { 200: onHandSchema }
  },
  /** Active items at or below their reorder level at a branch, lowest against their level first. */
  lowStock: {
    method: 'GET',
    path: '/stock/low',
    query: z.object({ branchId: z.string().uuid() }),
    responses: { 200: z.array(lowStockSchema) }
  },
  ledger: {
    method: 'GET',
    path: '/stock/ledger',
    /** A page of the movements, newest first. */
    query: pageQuerySchema.extend({ branchId: z.string().uuid(), itemId: z.string().uuid().optional() }),
    responses: { 200: z.array(stockLedgerSchema) }
  },
  /**
   * Batches with stock at a branch, earliest expiry first: of one item, or those expiring
   * within `expiringWithinDays` days (expired ones included) for the expiry report.
   */
  batches: {
    method: 'GET',
    path: '/stock/batches',
    query: z.object({
      branchId: z.string().uuid(),
      itemId: z.string().uuid().optional(),
      expiringWithinDays: z.coerce.number().int().min(0).max(3650).optional()
    }),
    responses: { 200: z.array(batchStockSchema) }
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
