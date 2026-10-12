/**
 * The service's settings, read from the environment (.env) when used, so tests can change them.
 * main.ts checks them all at startup, so a bad value stops the service instead of the first
 * payment.
 */

/** A product that may take payments here: its API key, and where and how its notices go. */
export type ProductConfig = {
  /** As products call it, e.g. "pos": in sessions, notices and the settings' names. */
  name: string;
  /** Sent by the product as `Authorization: Bearer <key>`. */
  apiKey: string;
  /** Signs the notices sent to the product (see @hackd/checkout-contracts). */
  notifySecret: string;
  /** Where the product receives notices, e.g. https://api.hackd.in/v1/pos/billing/webhooks/checkout. */
  notifyUrl: string;
};

const PRODUCT_NAME = /^[a-z][a-z0-9-]{0,30}$/;
const MIN_SECRET_LENGTH = 32;

/** CHECKOUT_<PRODUCT>_<SETTING>, e.g. CHECKOUT_POS_API_KEY. */
export const productSetting = (product: string, setting: string) => `CHECKOUT_${product.toUpperCase().replace(/-/g, '_')}_${setting}`;

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function httpUrl(name: string, value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a URL, not "${value}"`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`${name} must start with https://`);
  return value.replace(/\/+$/, '');
}

/** CHECKOUT_PRODUCTS (comma-separated names), each with its API key, notify secret and notify URL. */
export function products(): ProductConfig[] {
  const names = (process.env.CHECKOUT_PRODUCTS ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  return names.map((name) => {
    if (!PRODUCT_NAME.test(name)) throw new Error(`CHECKOUT_PRODUCTS: "${name}" must be lowercase letters, digits and dashes`);
    const apiKey = required(productSetting(name, 'API_KEY'));
    const notifySecret = required(productSetting(name, 'NOTIFY_SECRET'));
    for (const [setting, value] of [
      ['API_KEY', apiKey],
      ['NOTIFY_SECRET', notifySecret]
    ]) {
      if (value.length < MIN_SECRET_LENGTH) throw new Error(`${productSetting(name, setting)} must be at least ${MIN_SECRET_LENGTH} characters`);
    }
    const notifyUrlName = productSetting(name, 'NOTIFY_URL');
    return { name, apiKey, notifySecret, notifyUrl: httpUrl(notifyUrlName, required(notifyUrlName)) };
  });
}

export function product(name: string): ProductConfig | null {
  return products().find((candidate) => candidate.name === name) ?? null;
}

/** CHECKOUT_PUBLIC_URL: this service's address as payers' browsers reach it, e.g. https://api.hackd.in/v1/checkout. */
export function publicUrl() {
  return httpUrl('CHECKOUT_PUBLIC_URL', required('CHECKOUT_PUBLIC_URL'));
}

/** CHECKOUT_PROVIDER: the payment provider new sessions use (see providers/providers.ts). */
export function providerName() {
  return required('CHECKOUT_PROVIDER').toLowerCase();
}

/**
 * CHECKOUT_ALLOW_TEST_PAYMENTS=true: lets CHECKOUT_PROVIDER=dummy run. Its page marks a payment
 * paid without money moving, so it must never run where real customers pay.
 */
export function testPaymentsAllowed() {
  return process.env.CHECKOUT_ALLOW_TEST_PAYMENTS?.trim().toLowerCase() === 'true';
}

/** CHECKOUT_TIMER_SECONDS: how often timed work runs (closing expired sessions, sending notices and alerts again); default 30, 0 turns it off. */
export function timerSeconds() {
  const raw = process.env.CHECKOUT_TIMER_SECONDS?.trim();
  if (!raw) return 30;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`CHECKOUT_TIMER_SECONDS must be a whole number of seconds, not "${raw}"`);
  return value;
}

/** CHECKOUT_ALERT_EMAIL: who hears about payments to refund and notices products never took (comma-separated). */
export function alertRecipients() {
  return (process.env.CHECKOUT_ALERT_EMAIL ?? '')
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean);
}

/**
 * How alerts are emailed: SMTP_URL (with MAIL_FROM), or MAIL_TRANSPORT=log (printed to the log;
 * development) or memory (kept for tests). Null when none is set.
 */
export function mailMode(): 'smtp' | 'log' | 'memory' | null {
  const transport = process.env.MAIL_TRANSPORT?.trim().toLowerCase();
  if (transport === 'log' || transport === 'memory') return transport;
  return process.env.SMTP_URL?.trim() ? 'smtp' : null;
}

/** A provider that moves real money needs alerts that reach someone: money to refund must not sit in a log. */
export function requireAlerts(provider: string) {
  if (alertRecipients().length === 0 || mailMode() === null) {
    throw new Error(`CHECKOUT_PROVIDER=${provider} moves real money, so CHECKOUT_ALERT_EMAIL and SMTP_URL must be set: payments to refund are emailed there`);
  }
}

/** PORT (default 8004, the API gateway's upstream for /v1/checkout) and HOST. */
export function listenAddress() {
  const port = process.env.PORT ? Number(process.env.PORT) : 8004;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`PORT must be a port number, not "${process.env.PORT}"`);
  return { port, host: process.env.HOST?.trim() || undefined };
}
