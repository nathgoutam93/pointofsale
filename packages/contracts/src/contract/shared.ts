// The contract instance and the primitives the domain modules share.
import { initContract } from '@ts-rest/core';
import { z } from 'zod';
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
} from '../gst.js';

export const c: ReturnType<typeof initContract> = initContract();

export const roleSchema = z.enum(['ADMIN', 'CASHIER']);

/**
 * What an admin may let a cashier do, beyond selling (Settings → Cashiers & Access). Admins can
 * always do all of it.
 */
export const CASHIER_PERMISSIONS = ['MANAGE_STOCK', 'MANAGE_ITEMS', 'RECORD_PURCHASES', 'SEND_TRANSFERS', 'TOP_UP_WALLETS', 'CANCEL_SALES', 'MAKE_RETURNS', 'SELL_PAST_STOCK'] as const;
export const cashierPermissionSchema = z.enum(CASHIER_PERMISSIONS);
export type CashierPermission = z.infer<typeof cashierPermissionSchema>;
export const CASHIER_PERMISSION_LABELS: Record<CashierPermission, { label: string; detail: string }> = {
  MANAGE_STOCK: { label: 'Adjust stock', detail: 'Opening stock and stock adjustments' },
  MANAGE_ITEMS: { label: 'Manage items', detail: 'Add, edit and delete items in the catalogue, with their prices and images' },
  RECORD_PURCHASES: { label: 'Record purchases', detail: 'Goods received from suppliers' },
  SEND_TRANSFERS: { label: 'Send transfers', detail: 'Send stock to another branch, or call a transfer back' },
  TOP_UP_WALLETS: { label: 'Top up wallets', detail: "Add credit to a customer's wallet" },
  CANCEL_SALES: { label: 'Cancel unpaid bills', detail: 'Cancel a bill nothing has been paid on, on the day it was made' },
  MAKE_RETURNS: { label: 'Make returns', detail: 'Take goods back and refund them, within the return window' },
  SELL_PAST_STOCK: { label: 'Sell past stock', detail: 'Sell more than the stock count shows, when the business allows it' }
};

/** Whether a signed-in user may do `permission`: admins always, cashiers when given it. */
export function hasPermission(user: { role: 'ADMIN' | 'CASHIER'; permissions?: readonly string[] | null }, permission: CashierPermission) {
  return user.role === 'ADMIN' || !!user.permissions?.includes(permission);
}
export const paymentModeSchema = z.enum(['CASH', 'CARD', 'UPI', 'WALLET']);
export const returnRefundModeSchema = z.enum(['CASH', 'WALLET']);
export const invoiceStatusSchema = z.enum(['DRAFT', 'SETTLED', 'PARTIALLY_SETTLED', 'CANCELLED']);
export const stockTxnTypeSchema = z.enum([
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
export const stockTransferStatusSchema = z.enum(['IN_TRANSIT', 'RECEIVED', 'CANCELLED']);
export const walletTxnTypeSchema = z.enum(['TOPUP', 'DEBIT_SALE', 'REFUND_RETURN', 'ADJUSTMENT']);
export const taxModeSchema = z.enum(['INCLUSIVE', 'EXCLUSIVE']);
/** SHARED: customers and wallets work at every branch. BRANCH: only at the branch that created them. */
export const customerScopeSchema = z.enum(['SHARED', 'BRANCH']);
export const taxpayerTypeSchema = z.enum(TAXPAYER_TYPES);
export const compositionCategorySchema = z.enum(COMPOSITION_CATEGORIES);
export const gstDocumentTypeSchema = z.enum(GST_DOCUMENT_TYPES);
/** A branch code: exactly 3 letters or digits, upper-cased. It starts every invoice and credit note number. */
export const branchCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .superRefine((value, ctx) => {
    const problem = branchCodeProblem(value);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  });
/** A GSTIN, upper-cased, with its format, state code and check character verified. */
export const gstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .superRefine((value, ctx) => {
    const problem = gstinProblem(value);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  });
export const gstSupplyTypeSchema = z.enum(GST_SUPPLY_TYPES);
/** An HSN/SAC code: 4, 6 or 8 digits (the business's minimum length is checked by the API). */
export const hsnCodeSchema = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    const problem = hsnProblem(value, 4);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  });
export const gstUqcSchema = z.string().trim().toUpperCase().refine(isGstUqc, { message: 'Unknown GST unit (UQC)' });
/** A two-digit GST state code, e.g. 29 for Karnataka. */
export const gstStateCodeSchema = z.string().refine(isGstStateCode, { message: 'Unknown GST state code' });
/** A calendar date, YYYY-MM-DD, that exists (no 31 February). */
export const calendarDateSchema = z
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
export const timeZoneSchema = z.string().trim().min(1).refine(isValidTimeZone, { message: 'Unknown time zone' });
export const discountScopeSchema = z.enum(['ITEM', 'ORDER']);
export const discountTypeSchema = z.enum(['PERCENTAGE', 'FIXED']);

export const moneySchema = z.number().finite();
export const taxRateSchema = z.number().min(0).max(100);
export const requiredText = z.string().trim().min(1);
export const passwordSchema = z.string().min(8).max(128);


/** Rejects arrays where two entries share the same key (e.g. the same sale line twice). */
export const uniqueBy = <T>(key: (entry: T) => string, message: string) =>
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

/**
 * A page of a list, newest first: up to `limit` rows made before the row (`before`, `beforeId`)
 * the last page ended with. Without `before`, the newest.
 */
export const pageQuerySchema = z.object({
  before: z.string().datetime().optional(),
  beforeId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100)
});
/** Query strings arrive as text; z.coerce.boolean() would read "false" as true. */
export const queryBooleanSchema = z.enum(['true', 'false']).transform((value) => value === 'true');

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
