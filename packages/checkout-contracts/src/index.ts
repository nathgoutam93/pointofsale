/**
 * The checkout service (apps/checkout/api) takes payments for every product. This is all the two
 * sides agree on, so a change here breaks the typecheck of both in the same pull request:
 *
 * 1. A product starts a payment: POST <checkout>/sessions with `Authorization: Bearer <its API
 *    key>` and a CreateSessionRequest. The answer is a CheckoutSession; the payer is sent to its
 *    `payUrl`. Asking again with the same `reference` gives back the same session.
 * 2. The payer pays on the checkout service's page, which talks to the payment provider.
 * 3. The checkout service tells the product what happened: a POST of a CheckoutNotification to the
 *    product's notify URL, signed in the CHECKOUT_SIGNATURE_HEADER with the product's notify
 *    secret (signNotification / verifyNotification). Until the product answers 2xx it is sent
 *    again, with the same `id`, so the product must ignore an `id` it has already handled.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { z } from 'zod';

/** Request header that carries a notification's signature: `t=<unix seconds>,v1=<hex HMAC>`. */
export const CHECKOUT_SIGNATURE_HEADER = 'x-checkout-signature';

/** How old a signature may be, in seconds, before it's refused (so a copied notice can't be replayed later). */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export const createSessionRequestSchema = z.object({
  /** The product's own id for this payment (the POS's billing checkout id). One session per reference. */
  reference: z.string().trim().min(1).max(100),
  /** In paise, taxes included: what the payer is charged. */
  amount: z.number().int().positive(),
  currency: z.literal('INR'),
  /** Shown to the payer, e.g. "Growth plan, 1 month". */
  description: z.string().trim().min(1).max(200),
  customer: z.object({
    email: z.string().trim().email().max(254).nullable(),
    name: z.string().trim().max(200).nullable().default(null)
  }),
  /** Where the payer goes back to after paying, if anywhere. */
  returnUrl: z.string().url().max(2000).nullable().default(null),
  /** Up to 20 short values the product wants back in its notifications. */
  metadata: z
    .record(z.string().max(500))
    .refine((value) => Object.keys(value).length <= 20, 'At most 20 metadata values')
    .default({})
});
export type CreateSessionRequest = z.input<typeof createSessionRequestSchema>;

export const sessionStatusSchema = z.enum(['pending', 'paid', 'failed']);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const checkoutSessionSchema = z.object({
  id: z.string(),
  /** The product that started it, from its API key. */
  product: z.string(),
  reference: z.string(),
  amount: z.number().int(),
  currency: z.literal('INR'),
  /**
   * `pending` until the payer pays (`paid`) or a payment fails (`failed`). Either is final: the
   * page takes no more payments, and the payer starts a new one from the product, as the
   * product's own record of it is final too.
   */
  status: sessionStatusSchema,
  /** The checkout service's page for this payment. */
  payUrl: z.string().url(),
  createdAt: z.string(),
  paidAt: z.string().nullable()
});
export type CheckoutSession = z.infer<typeof checkoutSessionSchema>;

export const notificationTypeSchema = z.enum(['payment.succeeded', 'payment.failed']);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

export const checkoutNotificationSchema = z.object({
  /** Unique per event; a retry sends the same id. */
  id: z.string(),
  type: notificationTypeSchema,
  sessionId: z.string(),
  product: z.string(),
  reference: z.string(),
  /** Paise: what was paid (or tried). */
  amount: z.number().int(),
  currency: z.literal('INR'),
  /** Why a payment failed, as the provider put it. */
  reason: z.string().nullable(),
  metadata: z.record(z.string()),
  occurredAt: z.string()
});
export type CheckoutNotification = z.infer<typeof checkoutNotificationSchema>;

const hmac = (secret: string, timestamp: number, body: string | Buffer) =>
  createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex');

/** The signature header's value for `body`, the exact bytes sent. */
export function signNotification(secret: string, body: string | Buffer, timestamp = Math.floor(Date.now() / 1000)) {
  return `t=${timestamp},v1=${hmac(secret, timestamp, body)}`;
}

/**
 * True when `header` is a signature of `body` (the exact bytes received) with `secret`, made in
 * the last SIGNATURE_TOLERANCE_SECONDS (or a little in the future, for clocks that differ).
 */
export function verifyNotification(
  secret: string,
  body: string | Buffer,
  header: string | string[] | undefined,
  now = Math.floor(Date.now() / 1000),
  toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS
) {
  const value = Array.isArray(header) ? header[0] : header;
  const match = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/i.exec(value?.trim() ?? '');
  if (!match || !secret) return false;
  const timestamp = Number(match[1]);
  if (Math.abs(now - timestamp) > toleranceSeconds) return false;
  const expected = Buffer.from(hmac(secret, timestamp, body), 'hex');
  const given = Buffer.from(match[2], 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
