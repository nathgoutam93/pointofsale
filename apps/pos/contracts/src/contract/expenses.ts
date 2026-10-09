import { z } from 'zod';
import { c, calendarDateSchema, moneySchema, requiredText, supplierPaymentModeSchema } from './shared.js';

/** Suggested expense categories; any other name may be typed. */
export const EXPENSE_CATEGORIES = [
  'Rent',
  'Electricity',
  'Salaries and wages',
  'Tea and snacks',
  'Transport and delivery',
  'Cleaning',
  'Repairs and maintenance',
  'Stationery and packing',
  'Internet and phone',
  'Bank charges',
  'Other'
] as const;

/** Suggested reasons for cash put into or taken out of the drawer. */
export const CASH_IN_REASONS = ['Change added', 'Cash from owner'] as const;
export const CASH_OUT_REASONS = ['Cash to bank', 'Cash to owner'] as const;

export const cashMovementTypeSchema = z.enum(['CASH_IN', 'CASH_OUT']);

/** Cash put into or taken out of a register's drawer that isn't a sale, refund or expense. */
export const cashMovementSchema = z.object({
  id: z.string().uuid(),
  branchId: z.string().uuid(),
  registerSessionId: z.string().uuid(),
  type: cashMovementTypeSchema,
  amount: moneySchema,
  reason: z.string(),
  note: z.string().nullable(),
  createdByName: z.string(),
  createdAt: z.string().datetime()
});

/** Money the business spent, in cash from a drawer or otherwise. */
export const expenseSchema = z.object({
  id: z.string().uuid(),
  branchId: z.string().uuid(),
  /** The day it was paid. */
  date: z.string(),
  category: z.string(),
  amount: moneySchema,
  mode: supplierPaymentModeSchema,
  reference: z.string().nullable(),
  note: z.string().nullable(),
  /** Paid in cash from this register's drawer. */
  registerSessionId: z.string().uuid().nullable(),
  createdByName: z.string(),
  createdAt: z.string().datetime()
});

export const expensesRoutes = c.router({
  /** Cash in or out of the user's open register's drawer (admins, and cashiers allowed to). */
  cashMovement: {
    method: 'POST',
    path: '/registers/cash-movements',
    body: z.object({
      type: cashMovementTypeSchema,
      amount: moneySchema.positive(),
      reason: requiredText.max(60),
      note: z.string().trim().max(500).optional()
    }),
    responses: { 201: cashMovementSchema }
  },
  /** The user's open register: cash put in or taken out, and expenses paid from its drawer, newest first. */
  registerCashEntries: {
    method: 'GET',
    path: '/registers/cash-movements',
    responses: { 200: z.object({ movements: z.array(cashMovementSchema), expenses: z.array(expenseSchema) }) }
  },
  /** Records an expense (admins, and cashiers allowed to). Paid today unless a date is given. */
  create: {
    method: 'POST',
    path: '/expenses',
    body: z
      .object({
        branchId: z.string().uuid(),
        date: calendarDateSchema.optional(),
        category: requiredText.max(60),
        amount: moneySchema.positive(),
        mode: supplierPaymentModeSchema,
        /** Cash taken from this user's register at the branch (it lowers the cash expected at close). */
        fromDrawer: z.boolean().default(false),
        reference: z.string().trim().max(64).optional(),
        note: z.string().trim().max(500).optional()
      })
      .refine((body) => !body.fromDrawer || body.mode === 'CASH', { message: 'Only cash comes from the drawer', path: ['fromDrawer'] }),
    responses: { 201: expenseSchema }
  },
  /** A branch's expenses in a period (by the day paid), newest first, with totals by category. */
  list: {
    method: 'GET',
    path: '/expenses',
    query: z.object({ branchId: z.string().uuid(), from: calendarDateSchema, to: calendarDateSchema }),
    responses: {
      200: z.object({
        expenses: z.array(expenseSchema),
        byCategory: z.array(z.object({ category: z.string(), count: z.number().int(), total: moneySchema })),
        total: moneySchema
      })
    }
  },
  /** Admins: removes an expense entered by mistake (one from a drawer only while its register is open). */
  remove: {
    method: 'DELETE',
    path: '/expenses/:id',
    pathParams: z.object({ id: z.string().uuid() }),
    body: z.object({ reason: requiredText.max(200) }),
    responses: { 200: z.object({ id: z.string().uuid() }) }
  }
});
