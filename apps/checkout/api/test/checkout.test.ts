import { randomUUID } from 'crypto';
import { checkoutNotificationSchema, checkoutSessionSchema, CHECKOUT_SIGNATURE_HEADER, verifyNotification } from '@hackd/checkout-contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DUMMY_SIGNATURE_HEADER, signDummyWebhook } from '../src/providers/dummy-provider';
import { retryDelayMs } from '../src/notifications/notifications.service';
import { POS_SECRET, startApp, startProduct } from './helpers';

let api: Awaited<ReturnType<typeof startApp>>;
let pos: Awaited<ReturnType<typeof startProduct>>;

beforeAll(async () => {
  pos = await startProduct();
  api = await startApp();
});

afterAll(async () => {
  await api?.close();
  await pos?.close();
});

const sessionRequest = (overrides: Record<string, unknown> = {}) => ({
  reference: `chk_${randomUUID()}`,
  amount: 117882,
  currency: 'INR',
  description: 'Growth plan, 1 month',
  customer: { email: 'owner@example.com' },
  ...overrides
});

async function newSession(overrides: Record<string, unknown> = {}) {
  const res = await api.request('POST', '/sessions', { body: sessionRequest(overrides) });
  expect(res.status).toBe(201);
  return checkoutSessionSchema.parse(res.body);
}

/** The dummy provider's ref for a session, as its page link has it. */
async function providerRef(sessionId: string) {
  const res = await api.request('GET', `/pay/${sessionId}`, { key: null });
  expect(res.status).toBe(302);
  return res.location!.replace('../dummy/', '');
}

async function dummyWebhook(event: Record<string, unknown>) {
  const body = Buffer.from(JSON.stringify(event));
  const res = await fetch(`${api.baseUrl}/webhooks/dummy`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [DUMMY_SIGNATURE_HEADER]: signDummyWebhook(body) },
    body
  });
  return { status: res.status, body: await res.json() };
}

describe('the service', () => {
  it('says what it is', async () => {
    const res = await api.request('GET', '/meta', { key: null });
    expect(res.body).toEqual({ service: 'checkout', provider: 'dummy' });
  });
});

describe('sessions', () => {
  it('need a product API key', async () => {
    expect((await api.request('POST', '/sessions', { body: sessionRequest(), key: null })).status).toBe(401);
    expect((await api.request('POST', '/sessions', { body: sessionRequest(), key: 'not-a-key' })).status).toBe(401);
  });

  it('are checked against the contract', async () => {
    const res = await api.request('POST', '/sessions', { body: sessionRequest({ amount: 10.5 }) });
    expect(res.status).toBe(400);
    expect(res.body.message.join(' ')).toContain('amount');
  });

  it('start a payment with a link for the payer', async () => {
    const session = await newSession({ returnUrl: 'https://app.example.com/settings/billing' });
    expect(session).toMatchObject({ product: 'pos', amount: 117882, status: 'pending', paidAt: null });
    expect(session.payUrl).toBe(`https://api.example.com/v1/checkout/pay/${session.id}`);
    const read = await api.request('GET', `/sessions/${session.id}`);
    expect(read.body).toEqual(session);
  });

  it('give back the same session for the same reference, but not for another amount', async () => {
    const first = await newSession({ reference: 'chk_same' });
    const again = await api.request('POST', '/sessions', { body: sessionRequest({ reference: 'chk_same' }) });
    expect(again.body.id).toBe(first.id);
    const other = await api.request('POST', '/sessions', { body: sessionRequest({ reference: 'chk_same', amount: 999 }) });
    expect(other.status).toBe(409);
  });

  it('are private to their product', async () => {
    const session = await newSession();
    process.env.CHECKOUT_PRODUCTS = 'pos,shop';
    process.env.CHECKOUT_SHOP_API_KEY = 'shop-api-key-for-tests-0123456789abcdef';
    process.env.CHECKOUT_SHOP_NOTIFY_SECRET = 'shop-notify-secret-for-tests-012345678';
    process.env.CHECKOUT_SHOP_NOTIFY_URL = 'http://127.0.0.1:9/unused';
    try {
      const res = await api.request('GET', `/sessions/${session.id}`, { key: process.env.CHECKOUT_SHOP_API_KEY });
      expect(res.status).toBe(404);
    } finally {
      process.env.CHECKOUT_PRODUCTS = 'pos';
    }
  });
});

describe('paying', () => {
  it('sends the payer to the provider, and the product a signed notice once paid', async () => {
    const session = await newSession({ metadata: { plan: 'growth' } });
    const ref = await providerRef(session.id);
    const page = await api.request('GET', `/dummy/${ref}`, { key: null });
    expect(page.status).toBe(200);
    expect(page.text).toContain('₹1,178.82');
    expect(page.headers.get('content-security-policy')).toContain("default-src 'none'");

    const paid = await api.request('POST', `/dummy/${ref}`, { key: null, form: { outcome: 'pay' } });
    expect(paid.text).toContain('Payment received');
    expect((await api.request('GET', `/sessions/${session.id}`)).body).toMatchObject({ status: 'paid', paidAt: expect.any(String) });

    const [notice] = await pos.waitFor(session.id);
    expect(verifyNotification(POS_SECRET, notice.body, notice.headers[CHECKOUT_SIGNATURE_HEADER])).toBe(true);
    expect(checkoutNotificationSchema.parse(JSON.parse(notice.body))).toMatchObject({
      type: 'payment.succeeded',
      sessionId: session.id,
      product: 'pos',
      reference: session.reference,
      amount: 117882,
      reason: null,
      metadata: { plan: 'growth' }
    });

    // Paid: the link no longer leads to the provider.
    const after = await api.request('GET', `/pay/${session.id}`, { key: null });
    expect(after.text).toContain('Already paid');
  });

  it('sends the payer back to the product when it gave a return address', async () => {
    const session = await newSession({ returnUrl: 'https://app.example.com/settings/billing' });
    const ref = await providerRef(session.id);
    const paid = await api.request('POST', `/dummy/${ref}`, { key: null, form: { outcome: 'pay' } });
    expect(paid.status).toBe(302);
    expect(paid.location).toBe('https://app.example.com/settings/billing');
  });

  it('closes the session when a payment fails, and tells the product why', async () => {
    const session = await newSession();
    const ref = await providerRef(session.id);
    const failed = await api.request('POST', `/dummy/${ref}`, { key: null, form: { outcome: 'fail' } });
    expect(failed.text).toContain('This payment didn&#39;t go through');
    const [notice] = await pos.waitFor(session.id);
    expect(JSON.parse(notice.body)).toMatchObject({ type: 'payment.failed', reason: 'Failed on the test page' });

    // Final: paying afterwards changes nothing, and the product hears nothing more.
    await api.request('POST', `/dummy/${ref}`, { key: null, form: { outcome: 'pay' } });
    expect((await api.request('GET', `/sessions/${session.id}`)).body.status).toBe('failed');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(pos.forSession(session.id)).toHaveLength(1);
  });

  it('does not count a payment for the wrong amount', async () => {
    const session = await newSession();
    const ref = await providerRef(session.id);
    await dummyWebhook({ eventId: randomUUID(), type: 'payment.succeeded', providerRef: ref, amount: 100 });
    const [notice] = await pos.waitFor(session.id);
    expect(JSON.parse(notice.body)).toMatchObject({ type: 'payment.failed', amount: 100, reason: 'Paid 100 paise, not the 117882 asked for' });
    expect((await api.request('GET', `/sessions/${session.id}`)).body.status).toBe('failed');
  });
});

describe('provider webhooks', () => {
  it('are refused without the provider signature, and for another provider', async () => {
    const res = await fetch(`${api.baseUrl}/webhooks/dummy`, { method: 'POST', headers: { [DUMMY_SIGNATURE_HEADER]: '0'.repeat(64) }, body: '{}' });
    expect(res.status).toBe(400);
    expect((await fetch(`${api.baseUrl}/webhooks/razorpay`, { method: 'POST', body: '{}' })).status).toBe(404);
  });

  it('count once when the provider sends the same event again', async () => {
    const session = await newSession();
    const event = { eventId: randomUUID(), type: 'payment.succeeded', providerRef: await providerRef(session.id), amount: session.amount };
    expect((await dummyWebhook(event)).body).toEqual({ received: 1 });
    expect((await dummyWebhook(event)).status).toBe(200);
    await pos.waitFor(session.id);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(pos.forSession(session.id)).toHaveLength(1);
    expect(await api.db.notification.count({ where: { sessionId: session.id } })).toBe(1);
  });
});

describe('notices', () => {
  it('are sent again, with the same id, until the product answers', async () => {
    pos.answerWith(500);
    const session = await newSession();
    await api.request('POST', `/dummy/${await providerRef(session.id)}`, { key: null, form: { outcome: 'pay' } });
    await pos.waitFor(session.id);
    // The attempt is recorded once the product's answer is in.
    let waiting = await api.db.notification.findFirstOrThrow({ where: { sessionId: session.id } });
    for (let i = 0; i < 250 && waiting.attempts === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      waiting = await api.db.notification.findFirstOrThrow({ where: { sessionId: session.id } });
    }
    expect(waiting).toMatchObject({ attempts: 1, deliveredAt: null, lastError: expect.stringContaining('answered 500') });
    expect(waiting.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    // Not due yet: nothing is sent.
    await api.notifications.deliverDue();
    expect(pos.forSession(session.id)).toHaveLength(1);

    pos.answerWith(200);
    await api.db.notification.update({ where: { id: waiting.id }, data: { nextAttemptAt: new Date() } });
    await api.notifications.deliverDue();
    const delivered = await api.db.notification.findUniqueOrThrow({ where: { id: waiting.id } });
    expect(delivered).toMatchObject({ attempts: 2, deliveredAt: expect.any(Date), lastError: null });
    const [first, second] = pos.forSession(session.id);
    expect(JSON.parse(second.body).id).toBe(JSON.parse(first.body).id);
    expect(verifyNotification(POS_SECRET, second.body, second.headers[CHECKOUT_SIGNATURE_HEADER])).toBe(true);
  });

  it('wait longer after each failure, up to six hours', () => {
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(2)).toBe(60_000);
    expect(retryDelayMs(30)).toBe(6 * 60 * 60_000);
  });
});
