import { providerName } from '../config';
import { DummyProvider } from './dummy-provider';
import type { PaymentProvider } from './payment-provider';

/** Every provider the service knows, by CHECKOUT_PROVIDER name. A real one (Razorpay) is added here. */
const PROVIDERS: Record<string, () => PaymentProvider> = {
  dummy: () => new DummyProvider()
};

const instances = new Map<string, PaymentProvider>();

/** The provider CHECKOUT_PROVIDER names; throws for one this service doesn't know. */
export function paymentProvider(): PaymentProvider {
  const name = providerName();
  const make = PROVIDERS[name];
  if (!make) throw new Error(`CHECKOUT_PROVIDER must be one of ${Object.keys(PROVIDERS).join(', ')}, not "${name}"`);
  let provider = instances.get(name);
  if (!provider) {
    provider = make();
    instances.set(name, provider);
  }
  return provider;
}
