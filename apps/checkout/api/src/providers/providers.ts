import { providerName, requireAlerts, testPaymentsAllowed } from '../config';
import { DummyProvider } from './dummy-provider';
import type { PaymentProvider } from './payment-provider';

/** Every provider the service knows, by CHECKOUT_PROVIDER name. A real one (Razorpay) is added here. */
const PROVIDERS: Record<string, () => PaymentProvider> = {
  dummy: () => new DummyProvider()
};

const instances = new Map<string, PaymentProvider>();

/**
 * The provider CHECKOUT_PROVIDER names. Throws for one this service doesn't know, for the dummy
 * unless test payments are allowed, and for a real one without alerts set up.
 */
export function paymentProvider(): PaymentProvider {
  const name = providerName();
  const make = PROVIDERS[name];
  if (!make) throw new Error(`CHECKOUT_PROVIDER must be one of ${Object.keys(PROVIDERS).join(', ')}, not "${name}"`);
  if (name === 'dummy') {
    if (!testPaymentsAllowed()) {
      throw new Error(
        'CHECKOUT_PROVIDER=dummy takes test payments: anyone with a payment link can mark it paid without paying. ' +
          'Set CHECKOUT_ALLOW_TEST_PAYMENTS=true to run it, and never where real customers pay.'
      );
    }
  } else {
    requireAlerts(name);
  }
  let provider = instances.get(name);
  if (!provider) {
    provider = make();
    instances.set(name, provider);
  }
  return provider;
}
