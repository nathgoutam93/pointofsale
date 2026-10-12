import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { getSecret } from '../auth/token';
import { InvalidWebhookError, type CheckoutRequest, type GatewayEvent, type PaymentGateway } from './payment-gateway';

export const DUMMY_SIGNATURE_HEADER = 'x-dummy-signature';

/** Signs this server's own test webhooks; derived from AUTH_SECRET so it needs no setting. */
const signingKey = () => createHmac('sha256', getSecret()).update('billing:dummy-gateway').digest();

const sign = (body: Buffer) => createHmac('sha256', signingKey()).update(body).digest('hex');

/**
 * BILLING_GATEWAY=dummy: a stand-in gateway for development and testing. Its checkout page is
 * on this server (/billing/dummy/<ref>, see BillingController) with buttons to pay or to fail;
 * either sends a signed webhook through the same path a real gateway's would take. No money
 * moves, so never set it on a server real businesses pay on.
 */
export class DummyGateway implements PaymentGateway {
  readonly name = 'dummy';
  readonly note = 'Test payments: no money is taken.';

  async createCheckout(_request: CheckoutRequest) {
    const gatewayRef = `dummy_${randomUUID()}`;
    // Relative to /billing/pay/<checkoutId>: the dummy page, on whatever address this server has.
    return { gatewayRef, redirectUrl: `../dummy/${gatewayRef}` };
  }

  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): GatewayEvent[] {
    const given = headers[DUMMY_SIGNATURE_HEADER];
    const expected = Buffer.from(sign(rawBody), 'hex');
    const actual = typeof given === 'string' && /^[0-9a-f]{64}$/i.test(given) ? Buffer.from(given, 'hex') : null;
    if (!actual || !timingSafeEqual(actual, expected)) throw new InvalidWebhookError('Bad signature');
    let event: Partial<GatewayEvent>;
    try {
      event = JSON.parse(rawBody.toString('utf8')) as Partial<GatewayEvent>;
    } catch {
      throw new InvalidWebhookError('Not JSON');
    }
    const { eventId, type, gatewayRef, amount, reason } = event;
    if (
      typeof eventId !== 'string' ||
      (type !== 'payment.succeeded' && type !== 'payment.failed') ||
      typeof gatewayRef !== 'string' ||
      !Number.isInteger(amount)
    ) {
      throw new InvalidWebhookError('Not a payment event');
    }
    return [{ eventId, type, gatewayRef, amount: amount as number, reason: typeof reason === 'string' ? reason : undefined }];
  }

  /** What the dummy checkout page "receives from the gateway" when a button is pressed. */
  webhookFor(event: Omit<GatewayEvent, 'eventId'>) {
    const body = Buffer.from(JSON.stringify({ eventId: `evt_${randomUUID()}`, ...event }));
    return { body, headers: { [DUMMY_SIGNATURE_HEADER]: sign(body) } };
  }
}
