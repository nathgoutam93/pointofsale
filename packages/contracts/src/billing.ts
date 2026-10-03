import { z } from 'zod';

/**
 * Subscriptions on our managed hosting (POS_HOSTING=managed): a business starts on a trial, then
 * pays for a plan a month or a year at a time. Prices are in paise, before GST.
 *
 * The plans, prices and limits below are placeholders until pricing is decided (see
 * remaining-work-plan.md, "Pricing and limits"); change them here, the server and the screens
 * follow.
 */
export const BILLING_PERIODS = ['month', 'year'] as const;
export type BillingPeriod = (typeof BILLING_PERIODS)[number];

export const PLAN_CODES = ['starter', 'growth', 'business'] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export type Plan = {
  code: PlanCode;
  name: string;
  /** The most branches and active counters (all branches together) the plan allows. */
  branches: number;
  counters: number;
  /** Paise, before GST. */
  prices: Record<BillingPeriod, number>;
};

export const PLANS: readonly Plan[] = [
  { code: 'starter', name: 'Starter', branches: 1, counters: 2, prices: { month: 49_900, year: 4_99_000 } },
  { code: 'growth', name: 'Growth', branches: 3, counters: 10, prices: { month: 99_900, year: 9_99_000 } },
  { code: 'business', name: 'Business', branches: 10, counters: 50, prices: { month: 2_49_900, year: 24_99_000 } }
];

export const planByCode = (code: string): Plan | null => PLANS.find((plan) => plan.code === code) ?? null;

/** A new business (created online or moved online) tries this plan for TRIAL_DAYS. */
export const TRIAL_PLAN: PlanCode = 'growth';
export const TRIAL_DAYS = 14;
/** After the trial or the paid time ends, the business keeps working this long before turning read-only. */
export const GRACE_DAYS = 7;
/** GST on the subscription, when the seller (us) is registered (BILLING_SELLER_GSTIN). */
export const SUBSCRIPTION_GST_RATE = 18;

/** Error code (HTTP 402) of a change refused because the subscription has ended. */
export const PAYMENT_REQUIRED = 'PAYMENT_REQUIRED';
/** Error code (HTTP 403) of a branch or counter the plan has no room for. */
export const PLAN_LIMIT_REACHED = 'PLAN_LIMIT_REACHED';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * trial: within the free trial. active: paid. past_due: the trial or paid time has ended, still
 * working during the grace period. read_only: the grace period is over; sign-in, reading and
 * paying still work, changes don't.
 */
export const billingStateSchema = z.enum(['trial', 'active', 'past_due', 'read_only']);
export type BillingState = z.infer<typeof billingStateSchema>;

const toDate = (value: Date | string | null | undefined) => (value ? new Date(value) : null);

/** Where a business stands at `now`, from its trial end and paid-until dates. */
export function billingStateAt(dates: { trialEndsAt: Date | string | null; paidUntil: Date | string | null }, now = new Date()) {
  const trialEndsAt = toDate(dates.trialEndsAt);
  const paidUntil = toDate(dates.paidUntil);
  const ends = [trialEndsAt, paidUntil].filter((date): date is Date => date !== null);
  // Neither date: nothing was ever granted, so nothing is owed time.
  const endsAt = ends.length ? new Date(Math.max(...ends.map((date) => date.getTime()))) : null;
  const graceEndsAt = endsAt ? new Date(endsAt.getTime() + GRACE_DAYS * DAY_MS) : null;
  const paid = paidUntil !== null && paidUntil > now;
  let state: BillingState;
  if (endsAt && endsAt > now) state = paid ? 'active' : 'trial';
  else if (graceEndsAt && graceEndsAt > now) state = 'past_due';
  else state = 'read_only';
  return { state, endsAt, graceEndsAt };
}

/** `date` plus one period: a calendar month (31 Jan → 28/29 Feb) or a year. */
export function addBillingPeriod(date: Date, period: BillingPeriod) {
  const months = period === 'year' ? 12 : 1;
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

/** The GST on a price before GST, rounded to the paisa. */
export const subscriptionGst = (amount: number, gstRate: number) => Math.round((amount * gstRate) / 100);

const planCodeSchema = z.enum(PLAN_CODES);
const periodSchema = z.enum(BILLING_PERIODS);

/** What every signed-in user sees: enough for the banner. */
export const billingStatusSchema = z.object({
  /** false: this server doesn't charge (self-hosted, or payments not set up); nothing is enforced. */
  enforced: z.boolean(),
  state: billingStateSchema,
  plan: planCodeSchema,
  /** When the trial or the paid time ends; the grace period follows. */
  endsAt: z.string().datetime().nullable(),
  graceEndsAt: z.string().datetime().nullable()
});

const priceSchema = z.object({ amount: z.number().int(), gst: z.number().int(), total: z.number().int() });

export const billingPlanSchema = z.object({
  code: planCodeSchema,
  name: z.string(),
  branches: z.number().int(),
  counters: z.number().int(),
  /** Paise: before GST, the GST, and what is charged. */
  prices: z.object({ month: priceSchema, year: priceSchema })
});

export const billingInvoiceSummarySchema = z.object({
  id: z.string().uuid(),
  number: z.string(),
  issuedAt: z.string().datetime(),
  plan: planCodeSchema,
  period: periodSchema,
  total: z.number().int()
});

/** Admins: the Billing screen. */
export const billingSummarySchema = billingStatusSchema.extend({
  trialEndsAt: z.string().datetime().nullable(),
  paidUntil: z.string().datetime().nullable(),
  /** false: a payment can't be started on this server (no gateway set up). */
  paymentsEnabled: z.boolean(),
  /** The gateway's name, e.g. "dummy", and what admins should know about it. */
  gateway: z.string().nullable(),
  gatewayNote: z.string().nullable(),
  gstRate: z.number(),
  usage: z.object({ branches: z.number().int(), counters: z.number().int() }),
  plans: z.array(billingPlanSchema),
  invoices: z.array(billingInvoiceSummarySchema)
});

export const billingCheckoutBodySchema = z.object({ plan: planCodeSchema, period: periodSchema });

export const billingCheckoutResponseSchema = z.object({
  checkoutId: z.string().uuid(),
  /** On this API: opens the gateway's payment page (in the system browser, from the desktop app). */
  payPath: z.string()
});

export type BillingStatus = z.infer<typeof billingStatusSchema>;
export type BillingSummary = z.infer<typeof billingSummarySchema>;
