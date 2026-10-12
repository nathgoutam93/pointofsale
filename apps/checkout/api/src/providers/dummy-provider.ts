import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { InvalidWebhookError, type PaymentProvider, type PaymentRequest, type ProviderPaymentEvent } from './payment-provider';

export const DUMMY_SIGNATURE_HEADER = 'x-dummy-signature';

/** Only this process sends the dummy's webhooks (from its own page), so a key made at start is enough. */
const signingKey = randomBytes(32);

/** Signs a dummy webhook body as the dummy's page does; also used by the tests. */
export const signDummyWebhook = (body: Buffer) => createHmac('sha256', signingKey).update(body).digest('hex');

/**
 * CHECKOUT_PROVIDER=dummy: a stand-in provider for development and testing. Its page is on this
 * service (/dummy/<ref>, see PayController) with buttons to pay or to fail; either sends a
 * signed webhook through the same path a real provider's would take. No money moves, so never
 * use it where real customers pay.
 */
export class DummyProvider implements PaymentProvider {
  readonly name = 'dummy';

  async createPayment(_request: PaymentRequest) {
    const providerRef = `dummy_${randomUUID()}`;
    // Relative to /pay/<sessionId>: the dummy page, on whatever address this service has.
    return { providerRef, redirectUrl: `../dummy/${providerRef}` };
  }

  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): ProviderPaymentEvent[] {
    const given = headers[DUMMY_SIGNATURE_HEADER];
    const actual = typeof given === 'string' && /^[0-9a-f]{64}$/i.test(given) ? Buffer.from(given, 'hex') : null;
    const expected = Buffer.from(signDummyWebhook(rawBody), 'hex');
    if (!actual || !timingSafeEqual(actual, expected)) throw new InvalidWebhookError('Bad signature');
    let event: Partial<ProviderPaymentEvent>;
    try {
      event = JSON.parse(rawBody.toString('utf8')) as Partial<ProviderPaymentEvent>;
    } catch {
      throw new InvalidWebhookError('Not JSON');
    }
    if (
      typeof event.eventId !== 'string' ||
      (event.type !== 'payment.succeeded' && event.type !== 'payment.failed') ||
      typeof event.providerRef !== 'string' ||
      !Number.isInteger(event.amount)
    ) {
      throw new InvalidWebhookError('Not a payment event');
    }
    return [event as ProviderPaymentEvent];
  }
}
