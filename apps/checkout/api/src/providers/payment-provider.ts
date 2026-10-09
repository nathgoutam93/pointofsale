/**
 * How the checkout service talks to a payment provider. Everything else (sessions, products,
 * notices) never depends on the provider, so adding a real one (Razorpay…) means writing one
 * class like DummyProvider and listing it in PROVIDERS (providers.ts).
 */
export interface PaymentProvider {
  /** The value of CHECKOUT_PROVIDER that picks it, and the `:provider` of its webhook URL. */
  readonly name: string;
  /**
   * Starts a payment with the provider. Answers the provider's own id for it (its webhooks name
   * it) and the page the payer is sent to: absolute, or relative to /pay/<sessionId>.
   */
  createPayment(request: PaymentRequest): Promise<{ providerRef: string; redirectUrl: string }>;
  /**
   * A webhook delivery: checks it really comes from the provider (its signature over the exact
   * bytes received) and reads the payments it reports. Throws InvalidWebhookError when it doesn't.
   */
  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): ProviderPaymentEvent[];
}

export type PaymentRequest = {
  /** Our session id; providers that take a receipt or reference get this. */
  sessionId: string;
  /** Paise, taxes included. */
  amount: number;
  currency: 'INR';
  description: string;
  customerEmail: string | null;
  customerName: string | null;
};

/** A payment the provider reports, in our terms. `eventId` is unique per event, so a retried delivery is recognised. */
export type ProviderPaymentEvent = {
  eventId: string;
  type: 'payment.succeeded' | 'payment.failed';
  providerRef: string;
  /** Paise. Must match the session's amount for a payment to count. */
  amount: number;
  reason?: string;
};

/** Thrown by parseWebhook for a delivery that isn't from the provider; answered 400. */
export class InvalidWebhookError extends Error {}
