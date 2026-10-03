/**
 * How the server talks to a payment gateway. Everything else in billing (plans, prices, who
 * gets how long, invoices, read-only) is ours and never depends on the gateway, so adding a
 * real one (Razorpay, Stripe…) means writing one class like DummyGateway and listing it in
 * GATEWAYS (gateways.ts).
 */
export interface PaymentGateway {
  /** The value of BILLING_GATEWAY that picks it, and the `:gateway` of its webhook URL. */
  readonly name: string;
  /** Shown to admins next to the Pay button, e.g. "Test payments: no money is taken". */
  readonly note: string | null;
  /**
   * Starts a payment with the gateway. Answers the gateway's own id for it (its webhooks name
   * it) and the page the payer is sent to: absolute, or relative to /billing/pay/<checkoutId>.
   */
  createCheckout(request: CheckoutRequest): Promise<{ gatewayRef: string; redirectUrl: string }>;
  /**
   * A webhook delivery: checks it really comes from the gateway (its signature over the exact
   * bytes received) and reads the payments it reports. Throws when the signature is wrong.
   */
  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): GatewayEvent[];
}

export type CheckoutRequest = {
  /** Our BillingCheckout id; gateways that take a receipt or reference get this. */
  checkoutId: string;
  /** In paise, GST included: what the payer is charged. */
  amount: number;
  currency: 'INR';
  description: string;
  businessCode: string;
  customerEmail: string | null;
};

/** A payment the gateway reports, in our terms. `eventId` is unique per delivery, so a retry is recognised. */
export type GatewayEvent = {
  eventId: string;
  type: 'payment.succeeded' | 'payment.failed';
  gatewayRef: string;
  /** Paise. Must match the checkout's total for a payment to count. */
  amount: number;
  reason?: string;
};

/** Thrown by parseWebhook for a delivery that isn't from the gateway; answered 400. */
export class InvalidWebhookError extends Error {}
