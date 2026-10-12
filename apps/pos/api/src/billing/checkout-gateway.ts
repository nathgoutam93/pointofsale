import {
  CHECKOUT_SIGNATURE_HEADER,
  checkoutNotificationSchema,
  checkoutSessionSchema,
  type CreateSessionRequest,
  verifyNotification
} from '@hackd/checkout-contracts';
import { InvalidWebhookError, type CheckoutRequest, type GatewayEvent, type PaymentGateway } from './payment-gateway';

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Where the checkout service is and the two secrets it gave this product (the same values as its
 * CHECKOUT_POS_API_KEY and CHECKOUT_POS_NOTIFY_SECRET).
 */
export function checkoutSettings() {
  const read = (name: string) => {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`BILLING_GATEWAY=checkout needs ${name}`);
    return value;
  };
  const url = read('CHECKOUT_URL').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(url)) throw new Error(`CHECKOUT_URL must start with https://, not "${url}"`);
  return { url, apiKey: read('CHECKOUT_API_KEY'), notifySecret: read('CHECKOUT_NOTIFY_SECRET') };
}

/**
 * BILLING_GATEWAY=checkout: payments through our checkout service (apps/checkout), the one every
 * product uses. It holds the payment provider, its keys and its webhooks; this side starts a
 * session there and reads the service's signed notices at /billing/webhooks/checkout. What the two
 * send each other is @hackd/checkout-contracts.
 */
export class CheckoutGateway implements PaymentGateway {
  readonly name = 'checkout';
  readonly note = null;

  constructor() {
    // Fail at startup (main.ts builds the gateway) rather than on the first payment.
    checkoutSettings();
  }

  async createCheckout(request: CheckoutRequest) {
    const { url, apiKey } = checkoutSettings();
    const body: CreateSessionRequest = {
      // Our checkout id: asking again for the same one gives back the same session.
      reference: request.checkoutId,
      amount: request.amount,
      currency: request.currency,
      description: request.description,
      customer: { email: request.customerEmail },
      metadata: { businessCode: request.businessCode }
    };
    const response = await fetch(`${url}/sessions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 200);
      throw new Error(`The checkout service answered ${response.status}${detail ? `: ${detail}` : ''}`);
    }
    const session = checkoutSessionSchema.parse(await response.json());
    return { gatewayRef: session.id, redirectUrl: session.payUrl };
  }

  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): GatewayEvent[] {
    if (!verifyNotification(checkoutSettings().notifySecret, rawBody, headers[CHECKOUT_SIGNATURE_HEADER])) {
      throw new InvalidWebhookError('Bad signature');
    }
    let notice;
    try {
      notice = checkoutNotificationSchema.parse(JSON.parse(rawBody.toString('utf8')));
    } catch {
      throw new InvalidWebhookError('Not a checkout notice');
    }
    // The notice id stays the same when the service sends it again, so a retry counts once.
    return [{ eventId: notice.id, type: notice.type, gatewayRef: notice.sessionId, amount: notice.amount, reason: notice.reason ?? undefined }];
  }
}
