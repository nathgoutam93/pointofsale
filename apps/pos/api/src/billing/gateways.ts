import { isManagedHosting } from '../common/mode';
import { CheckoutGateway } from './checkout-gateway';
import { DummyGateway } from './dummy-gateway';
import type { PaymentGateway } from './payment-gateway';

/**
 * Every gateway the server knows, by BILLING_GATEWAY name. Real payments go through our checkout
 * service (checkout), which every product shares; dummy stays for development and tests.
 */
const GATEWAYS: Record<string, () => PaymentGateway> = {
  checkout: () => new CheckoutGateway(),
  dummy: () => new DummyGateway()
};

const instances = new Map<string, PaymentGateway>();

/** BILLING_GATEWAY: which gateway takes payments; unset, none does. */
export function configuredGatewayName(): string | null {
  const value = process.env.BILLING_GATEWAY?.trim().toLowerCase();
  if (!value) return null;
  if (!GATEWAYS[value]) {
    throw new Error(`BILLING_GATEWAY must be one of ${Object.keys(GATEWAYS).join(', ')}, not "${process.env.BILLING_GATEWAY}"`);
  }
  return value;
}

export function paymentGateway(): PaymentGateway | null {
  const name = configuredGatewayName();
  if (!name) return null;
  let gateway = instances.get(name);
  if (!gateway) {
    gateway = GATEWAYS[name]();
    instances.set(name, gateway);
  }
  return gateway;
}

/**
 * Subscriptions are charged and enforced (trial, read-only, plan limits) only on our managed
 * hosting with a gateway set up. Anywhere else nothing changes, so setting POS_HOSTING=managed
 * alone, or a self-hosted server, behaves as before.
 */
export const billingEnforced = () => isManagedHosting() && paymentGateway() !== null;
