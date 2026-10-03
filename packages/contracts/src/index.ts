import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { RECEIPT_CSS_MAX_LENGTH, sanitizeReceiptCss } from './receiptCss.js';
import { receiptTemplateSchema } from './receiptTemplate.js';

export { RECEIPT_CSS_MAX_LENGTH, RECEIPT_CSS_SCOPE, sanitizeReceiptCss } from './receiptCss.js';
export type { ReceiptCssResult } from './receiptCss.js';
export {
  paperFromLegacyCss,
  presetTemplate,
  RECEIPT_PAPER_IDS,
  RECEIPT_PAPERS,
  RECEIPT_SECTION_LABELS,
  RECEIPT_SECTIONS,
  RECEIPT_STYLE_LABELS,
  RECEIPT_STYLE_PRESETS,
  RECEIPT_STYLES,
  receiptPaperSchema,
  receiptTemplateSchema,
  resolveReceiptTemplate
} from './receiptTemplate.js';
export type { ReceiptPaper, ReceiptSection, ReceiptSections, ReceiptStyle, ReceiptTemplate } from './receiptTemplate.js';
export { fitCenter, fitLeft, fitRight, receiptColumns, renderReceipt, tableColumns, wrapText } from './receiptLayout.js';
export type { ReceiptDocument, ReceiptDocumentItem, ReceiptField, ReceiptLine, RenderedReceipt } from './receiptLayout.js';
export { canEncodeCode128, code128Modules, code128Values } from './code128.js';
export {
  COMPOSITION_DECLARATION,
  formatReceiptDate,
  formatReceiptTime,
  gstDocumentTitle,
  gstFooterLines,
  gstMetadata,
  gstTaxAmounts,
  invoiceDue,
  invoiceGstOf,
  invoiceReceiptItems,
  rateFromAmounts,
  returnReceiptDocument,
  saleReceiptDocument,
  settingLines,
  splitReturn
} from './receiptDocuments.js';
export type { InvoiceGst, ReceiptBranding } from './receiptDocuments.js';
export { APP_VERSION, CLIENT_VERSION_HEADER, isOlderVersion, UPDATE_REQUIRED_STATUS } from './version.js';
export {
  MIGRATION_BUNDLE_FORMAT,
  MIGRATION_EXCLUDED_MODELS,
  MIGRATION_TABLES,
  migrationManifestSchema
} from './migration.js';
export type { MigrationImportResult, MigrationManifest, MigrationTable } from './migration.js';
export {
  allocateDiscountAcrossBases,
  computeSaleTotals,
  exclusiveBase,
  lineTax,
  resolveDiscountAmounts,
  returnLineAmounts,
  splitGst
} from './pricing.js';
export type { DiscountInput, GstAmounts, PricedLineInput, ResolvedDiscount, TaxCalculationMode, TaxMode } from './pricing.js';
export {
  chargesGst,
  COMPOSITION_CATEGORIES,
  COMPOSITION_CATEGORY_LABELS,
  COMPOSITION_RATES,
  documentTypeFor,
  defaultSupplyType,
  BRANCH_CODE_LENGTH,
  branchCodeProblem,
  documentNumber,
  documentSeries,
  documentYearCode,
  financialYearCode,
  financialYearLabel,
  financialYearStart,
  GST_DOCUMENT_NUMBER_MAX_LENGTH,
  MAX_COUNTERS_PER_BRANCH,
  GST_DOCUMENT_TYPES,
  GST_STATES,
  GST_SUPPLY_TYPE_LABELS,
  GST_SUPPLY_TYPES,
  GST_UQCS,
  gstinCheckCharacter,
  gstinProblem,
  gstStateLabel,
  hsnProblem,
  isGstStateCode,
  isGstUqc,
  suggestUqc,
  supplyTypeProblem,
  TAXPAYER_TYPES,
  UOM_TO_UQC
} from './gst.js';
export type { CompositionCategory, GstDocumentType, GstSupplyType, TaxpayerType } from './gst.js';
import {
  branchCodeProblem,
  COMPOSITION_CATEGORIES,
  GST_DOCUMENT_TYPES,
  GST_SUPPLY_TYPES,
  gstinProblem,
  hsnProblem,
  isGstStateCode,
  isGstUqc,
  TAXPAYER_TYPES
} from './gst.js';

const c = initContract();

const roleSchema = z.enum(['ADMIN', 'CASHIER']);

/**
 * What an admin may let a cashier do, beyond selling (Settings → Cashiers & Access). Admins can
 * always do all of it.
 */
export const CASHIER_PERMISSIONS = ['MANAGE_STOCK', 'MANAGE_ITEMS', 'RECORD_PURCHASES', 'SEND_TRANSFERS', 'TOP_UP_WALLETS', 'CANCEL_SALES'] as const;
export const cashierPermissionSchema = z.enum(CASHIER_PERMISSIONS);
export type CashierPermission = z.infer<typeof cashierPermissionSchema>;
export const CASHIER_PERMISSION_LABELS: Record<CashierPermission, { label: string; detail: string }> = {
  MANAGE_STOCK: { label: 'Adjust stock', detail: 'Opening stock and stock adjustments' },
  MANAGE_ITEMS: { label: 'Manage items', detail: 'Add, edit and delete items in the catalogue, with their prices and images' },
  RECORD_PURCHASES: { label: 'Record purchases', detail: 'Goods received from suppliers' },
  SEND_TRANSFERS: { label: 'Send transfers', detail: 'Send stock to another branch, or call a transfer back' },
  TOP_UP_WALLETS: { label: 'Top up wallets', detail: "Add credit to a customer's wallet" },
  CANCEL_SALES: { label: 'Cancel unpaid bills', detail: 'Cancel a bill nothing has been paid on' }
};

/** Whether a signed-in user may do `permission`: admins always, cashiers when given it. */
export function hasPermission(user: { role: 'ADMIN' | 'CASHIER'; permissions?: readonly string[] | null }, permission: CashierPermission) {
  return user.role === 'ADMIN' || !!user.permissions?.includes(permission);
}
const paymentModeSchema = z.enum(['CASH', 'CARD', 'WALLET']);
const returnRefundModeSchema = z.enum(['CASH', 'WALLET']);
const invoiceStatusSchema = z.enum(['DRAFT', 'SETTLED', 'PARTIALLY_SETTLED', 'CANCELLED']);
const stockTxnTypeSchema = z.enum([
  'OPENING',
  'ADJUSTMENT_PLUS',
  'ADJUSTMENT_MINUS',
  'SALE',
  'RETURN',
  'SALE_CANCEL',
  'PURCHASE',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'TRANSFER_CANCEL'
]);
const stockTransferStatusSchema = z.enum(['IN_TRANSIT', 'RECEIVED', 'CANCELLED']);
const walletTxnTypeSchema = z.enum(['TOPUP', 'DEBIT_SALE', 'REFUND_RETURN', 'ADJUSTMENT']);
const taxModeSchema = z.enum(['INCLUSIVE', 'EXCLUSIVE']);
const taxCalculationModeSchema = z.enum(['AFTER_DISCOUNT', 'BEFORE_DISCOUNT']);
/** SHARED: customers and wallets work at every branch. BRANCH: only at the branch that created them. */
const customerScopeSchema = z.enum(['SHARED', 'BRANCH']);
const taxpayerTypeSchema = z.enum(TAXPAYER_TYPES);
const compositionCategorySchema = z.enum(COMPOSITION_CATEGORIES);
const gstDocumentTypeSchema = z.enum(GST_DOCUMENT_TYPES);
/** A branch code: exactly 3 letters or digits, upper-cased. It starts every invoice and credit note number. */
const branchCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .superRefine((value, ctx) => {
    const problem = branchCodeProblem(value);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  });
/** A GSTIN, upper-cased, with its format, state code and check character verified. */
const gstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .superRefine((value, ctx) => {
    const problem = gstinProblem(value);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  });
const gstSupplyTypeSchema = z.enum(GST_SUPPLY_TYPES);
/** An HSN/SAC code: 4, 6 or 8 digits (the business's minimum length is checked by the API). */
const hsnCodeSchema = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    const problem = hsnProblem(value, 4);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  });
const gstUqcSchema = z.string().trim().toUpperCase().refine(isGstUqc, { message: 'Unknown GST unit (UQC)' });
/** A two-digit GST state code, e.g. 29 for Karnataka. */
const gstStateCodeSchema = z.string().refine(isGstStateCode, { message: 'Unknown GST state code' });
/** A calendar date, YYYY-MM-DD, that exists (no 31 February). */
const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Use the format YYYY-MM-DD' })
  .refine(
    (value) => {
      const [year, month, day] = value.split('-').map(Number);
      const date = new Date(Date.UTC(year, month - 1, day));
      return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
    },
    { message: 'Not a real date' }
  );

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

/** Running cash for a register: cash payments taken on it and cash refunds given from it. */
const registerCashSchema = z.object({
  cashSales: moneySchema,
  cashRefunds: moneySchema,
  expectedCash: moneySchema
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
  taxCalculationMode: taxCalculationModeSchema,
  cashierMaxDiscountPercent: z.number(),
  customerScope: customerScopeSchema,
  /** IANA zone report periods are worked out in, e.g. Asia/Kolkata. */
  timezone: z.string(),
  /** The GST registration type in force now (see /business/taxpayer-type for history). */
  taxpayerType: taxpayerTypeSchema,
  compositionCategory: compositionCategorySchema.nullable(),
  /** Shortest HSN code accepted on items: 4 (turnover up to ₹5 crore) or 6. */
  hsnMinDigits: z.number().int()
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

export const userSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  role: roleSchema,
  branchId: z.string().uuid(),
  branchIds: z.array(z.string().uuid()),
  isActive: z.boolean(),
  /** An admin set their password; they haven't chosen their own yet. */
  mustChangePassword: z.boolean().default(false),
  /** Cashiers only: what they may do beyond selling. */
  permissions: z.array(cashierPermissionSchema).default([]),
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
  unitCost: moneySchema.nonnegative()
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
  createdByName: z.string(),
  createdAt: z.string().datetime(),
  lines: z.array(
    purchaseLineInputSchema.extend({
      id: z.string().uuid(),
      amount: moneySchema,
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
  cgstTotal: moneySchema.default(0),
  sgstTotal: moneySchema.default(0),
  igstTotal: moneySchema.default(0),
  grandTotal: moneySchema,
  paidTotal: moneySchema,
  /** Taken off what was owed by returns made before the bill was paid in full (see invoiceDue). */
  creditedTotal: moneySchema.default(0),
  status: invoiceStatusSchema,
  createdBy: z.string().uuid(),
  createdByName: z.string(),
  createdAt: z.string().datetime(),
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
  discounts: z.array(discountInputSchema).default([]),
  /** Where the goods go, when shipped to another state. Defaults to the branch's state (sold over the counter). */
  placeOfSupplyStateCode: gstStateCodeSchema.optional()
});

const paymentInputSchema = z.object({ mode: paymentModeSchema, amount: moneySchema.positive(), reference: z.string().optional() });

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

/** A signed-in session, as returned by sign-in and by first-run setup. */
const loginResponseSchema = z.object({
  token: z.string(),
  userId: z.string().uuid(),
  username: z.string(),
  role: roleSchema,
  branchId: z.string().uuid().nullable(),
  registerId: z.string().uuid().nullable(),
  /** The counter of the open register, if any. */
  counterId: z.string().uuid().nullable(),
  counterName: z.string().nullable(),
  branches: z.array(branchSchema),
  /** An admin set this password: the user chooses their own before doing anything else. */
  mustChangePassword: z.boolean().default(false),
  /** Cashiers: what they may do beyond selling (see hasPermission). */
  permissions: z.array(cashierPermissionSchema).default([])
});

/**
 * Web clients keep the sign-in in an httpOnly cookie (named SESSION_COOKIE), which page scripts
 * can't read. They send this header with the value "cookie" on every request: only then does the
 * API read the cookie (a form or link from another site can't add a header), and in answers it
 * sets the cookie instead of returning the token.
 */
export const SESSION_HEADER = 'x-pos-session';
export const SESSION_COOKIE = 'pos_session';

/** The `code` of the 403 a user gets until they choose a new password (see auth.changePassword). */
export const PASSWORD_CHANGE_REQUIRED = 'PASSWORD_CHANGE_REQUIRED';

/** The code emailed to an owner to reset their password: 8 digits. */
const resetCodeSchema = z.string().trim().regex(/^\d{8}$/, 'Enter the 8-digit code from the email');

/**
 * The `code` of the 400 answered when an owner's email isn't verified yet: a code was just
 * emailed to it, and the same request is sent again with `emailCode`.
 */
export const EMAIL_VERIFICATION_REQUIRED = 'EMAIL_VERIFICATION_REQUIRED';
/** The emailed verification code, when the server asked for one. */
const emailCodeSchema = z.string().trim().regex(/^\d{8}$/, 'Enter the 8-digit code from the email').optional();

/** offline: one branch and one counter, all on this machine. online: the hosted, multi-business server. */
export const posModeSchema = z.enum(['offline', 'online']);
export type PosMode = z.infer<typeof posModeSchema>;

/**
 * Online servers only. managed: our hosted service, where businesses sign up and pay a
 * subscription. self: a business's own server (any other), with no billing.
 */
export const hostingSchema = z.enum(['managed', 'self']);
export type Hosting = z.infer<typeof hostingSchema>;

/** ACTIVE: in use. MIGRATING: being moved online, writes paused. ARCHIVED: moved online, read-only. */
export const localInstanceStatusSchema = z.enum(['ACTIVE', 'MIGRATING', 'ARCHIVED']);

export const metaSchema = z.object({
  appVersion: z.string(),
  /** The last database migration applied, e.g. 20261005110000_counter_document_numbers. */
  schemaVersion: z.string().nullable(),
  mode: posModeSchema,
  /** Online only: our managed service or a self-hosted server. Missing from older servers. */
  hosting: hostingSchema.nullable().optional(),
  /** Online only: clients older than this must update before using the API. */
  minClientVersion: z.string().nullable(),
  /** Offline only: true until first-run setup has created the business and its admin. */
  setupRequired: z.boolean(),
  /** Offline only: whether this machine's business is in use, moving online, or has moved. */
  instanceStatus: localInstanceStatusSchema.nullable(),
  /** Offline, once moved: the online business to sign in to instead. */
  movedTo: z.object({ businessCode: z.string(), server: z.string() }).nullable()
});

/** Offline: the last step of moving online, once the server has imported the business. */
export const migrationCompleteBodySchema = z.object({
  businessId: z.string().uuid(),
  businessCode: z.string().min(1).max(16),
  server: z.string().url()
});

/** A new business and its first admin: first-run setup offline, sign-up online. */
const businessSetupSchema = z.object({
  businessName: requiredText.pipe(z.string().max(120)),
  gstNumber: gstinSchema.nullable().optional(),
  /** Where the shop is; taken from the GSTIN when one is given. */
  stateCode: gstStateCodeSchema.nullable().optional(),
  timezone: timeZoneSchema.default('Asia/Kolkata'),
  taxpayerType: taxpayerTypeSchema.default('REGULAR'),
  compositionCategory: compositionCategorySchema.nullable().optional(),
  /** Starts every invoice number; MAI if not given. */
  branchCode: branchCodeSchema.default('MAI'),
  adminUsername: requiredText.pipe(z.string().max(64)),
  adminPassword: passwordSchema
});

function checkBusinessSetup(
  body: { taxpayerType: string; compositionCategory?: string | null; gstNumber?: string | null; stateCode?: string | null },
  ctx: z.RefinementCtx
) {
  if ((body.taxpayerType === 'COMPOSITION') !== !!body.compositionCategory) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A composition taxpayer needs a category, and a regular one must not have one',
      path: ['compositionCategory']
    });
  }
  if (body.gstNumber && body.stateCode && body.gstNumber.slice(0, 2) !== body.stateCode) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "The state doesn't match the GSTIN", path: ['stateCode'] });
  }
}

const emailSchema = z.string().trim().toLowerCase().email().max(254);

/** A business as its owner sees it. `code` is what staff type when signing in. */
export const ownedBusinessSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  status: z.enum(['PROVISIONING', 'ACTIVE', 'SUSPENDED', 'FAILED'])
});

export const appContract = c.router({
  gst: {
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
    /** The sales side of GSTR-3B: Tables 3.1 and 3.2 (no input tax credit: purchases aren't recorded). */
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
  },
  meta: {
    get: {
      method: 'GET',
      path: '/meta',
      responses: { 200: metaSchema }
    }
  },
  setup: {
    /** Offline only, and only while the database has no users: creates the business and its first admin. */
    run: {
      method: 'POST',
      path: '/setup',
      body: businessSetupSchema.superRefine(checkBusinessSetup),
      responses: {
        201: loginResponseSchema.extend({
          /** Shown once: resets a forgotten admin password (see auth.recover). */
          recoveryCode: z.string().nullable()
        })
      }
    }
  },
  businesses: {
    /**
     * Online only: creates a business and signs its admin in. The owner's account (email and
     * password) is created on first use; later businesses need the same password.
     */
    create: {
      method: 'POST',
      path: '/businesses',
      body: businessSetupSchema
        .extend({ ownerEmail: emailSchema, ownerPassword: passwordSchema, emailCode: emailCodeSchema })
        .superRefine(checkBusinessSetup),
      responses: {
        201: z.object({ business: ownedBusinessSchema, session: loginResponseSchema, accountToken: z.string() })
      }
    }
  },
  accounts: {
    /** Online only: creates an owner account, or signs in to an existing one with its password. */
    signup: {
      method: 'POST',
      path: '/accounts/signup',
      body: z.object({ email: emailSchema, password: passwordSchema, emailCode: emailCodeSchema }),
      responses: { 200: z.object({ token: z.string(), businesses: z.array(ownedBusinessSchema) }) }
    },
    /** Online only: an owner's sign-in. The token lists and manages their businesses (not sales). */
    login: {
      method: 'POST',
      path: '/accounts/login',
      body: z.object({ email: emailSchema, password: z.string() }),
      responses: { 200: z.object({ token: z.string(), businesses: z.array(ownedBusinessSchema) }) }
    },
    businesses: {
      method: 'GET',
      path: '/accounts/businesses',
      responses: { 200: z.array(ownedBusinessSchema) }
    },
    /**
     * Online, owner token: a new password for a staff user of one of the owner's businesses
     * (an admin who forgot theirs). Their other sessions end; an inactive admin is reactivated.
     */
    staffPassword: {
      method: 'POST',
      path: '/accounts/staff-password',
      body: z.object({ businessId: z.string().uuid(), username: z.string().trim().min(1), newPassword: passwordSchema }),
      responses: { 200: z.object({ username: z.string() }) }
    },
    /**
     * Online, no sign-in: emails an 8-digit code to reset an owner's password. Answers the same
     * whether or not the email has an account.
     */
    requestPasswordReset: {
      method: 'POST',
      path: '/accounts/password-reset',
      body: z.object({ email: emailSchema }),
      responses: { 202: z.object({ sent: z.literal(true) }) }
    },
    /** Online, no sign-in: the emailed code and a new password. Signs the owner out everywhere. */
    confirmPasswordReset: {
      method: 'POST',
      path: '/accounts/password-reset/confirm',
      body: z.object({ email: emailSchema, code: resetCodeSchema, newPassword: passwordSchema }),
      responses: { 200: z.object({ reset: z.literal(true) }) }
    }
  },
  auth: {
    login: {
      method: 'POST',
      path: '/auth/login',
      body: z.object({
        /** Online (hosted) server: which business to sign in to. Not used offline. */
        businessCode: z.string().trim().toUpperCase().max(16).optional(),
        username: z.string(),
        password: z.string()
      }),
      responses: { 200: loginResponseSchema }
    },
    /**
     * Offline only, no sign-in: a forgotten admin password, reset with the business's recovery
     * code. The code is replaced; the answer is the new one, shown once.
     */
    recover: {
      method: 'POST',
      path: '/auth/recover',
      body: z.object({ recoveryCode: z.string().trim().min(1), username: z.string().trim().min(1), newPassword: passwordSchema }),
      responses: { 200: z.object({ recoveryCode: z.string() }) }
    },
    /**
     * Signed in: the user's own new password. Needed before anything else when an admin set
     * their password. Other sessions end; this one gets a new token.
     */
    changePassword: {
      method: 'POST',
      path: '/auth/change-password',
      body: z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema }),
      responses: { 200: z.object({ token: z.string() }) }
    },
    /** Offline, admins: whether a recovery code exists, and since when. */
    recoveryCodeStatus: {
      method: 'GET',
      path: '/auth/recovery-code',
      responses: { 200: z.object({ set: z.boolean(), createdAt: z.string().datetime().nullable() }) }
    },
    /** Offline, admins: a new recovery code (the old one stops working), shown once. */
    newRecoveryCode: {
      method: 'POST',
      path: '/auth/recovery-code',
      body: z.object({}).optional(),
      responses: { 201: z.object({ recoveryCode: z.string() }) }
    },
    /** Ends this browser's sign-in: clears the session cookie. */
    logout: {
      method: 'POST',
      path: '/auth/logout',
      body: z.object({}).optional(),
      responses: { 204: z.undefined() }
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
          branches: z.array(branchSchema),
          permissions: z.array(cashierPermissionSchema).default([])
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
        gstNumber: gstinSchema.nullable().optional(),
        taxCalculationMode: taxCalculationModeSchema.optional(),
        cashierMaxDiscountPercent: z.number().min(0).max(100).optional(),
        customerScope: customerScopeSchema.optional(),
        timezone: timeZoneSchema.optional(),
        hsnMinDigits: z.union([z.literal(4), z.literal(6)]).optional()
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
      /** The branch it's done at; defaults to the open register's. Admins may name any branch they manage. */
      query: z.object({ branchId: z.string().uuid().optional() }),
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
      /** The branch it's done at; defaults to the open register's. Admins may name any branch they manage. */
      query: z.object({ branchId: z.string().uuid().optional() }),
      responses: { 200: walletSchema }
    },
    topupWallet: {
      method: 'POST',
      path: '/customers/:id/wallet/topup',
      /** The branch it's done at; defaults to the open register's. Admins may name any branch they manage. */
      query: z.object({ branchId: z.string().uuid().optional() }),
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
          .optional(),
        permissions: z.array(cashierPermissionSchema).superRefine(uniqueBy((permission) => permission, 'Permission is listed more than once')).optional()
      }),
      responses: { 201: userSchema }
    },
    update: {
      method: 'PATCH',
      path: '/users/:id',
      body: z.object({
        username: requiredText.optional(),
        password: passwordSchema.optional(),
        /**
         * With `password`: the user must choose their own at next sign-in. Defaults to true when
         * an admin sets someone else's password. Either way their sessions end.
         */
        mustChangePassword: z.boolean().optional(),
        isActive: z.boolean().optional(),
        /** Replaces the cashier's permissions. */
        permissions: z.array(cashierPermissionSchema).superRefine(uniqueBy((permission) => permission, 'Permission is listed more than once')).optional()
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
  counters: {
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
  },
  registers: {
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
  purchases: {
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
  },
  transfers: {
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
      // The invoice id, or its number URL-encoded (numbers contain '/', e.g. MAIN%2F2627%2F00001).
      path: '/receipts/by-invoice/:invoiceId',
      responses: { 200: z.array(receiptSchema) }
    }
  },
  returns: {
    list: {
      method: 'GET',
      path: '/returns',
      /** Default: the open register's branch. Admins may name any branch they manage. */
      query: z.object({ branchId: z.string().uuid().optional() }),
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
