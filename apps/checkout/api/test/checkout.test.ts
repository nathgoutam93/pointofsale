import { randomUUID } from 'crypto';
import { checkoutNotificationSchema, checkoutSessionSchema, CHECKOUT_SIGNATURE_HEADER, verifyNotification } from '@hackd/checkout-contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mailOutbox } from '../src/alerts/mail';
import { requireAlerts } from '../src/config';
import { retryDelayMs } from '../src/common/retry';
import { MAX_ATTEMPTS } from '../src/notifications/notifications.service';
import { CLOSE_AFTER_EXPIRY_MS, SESSION_LIFETIME_MS } from '../src/payments/payments.service';
import { DUMMY_SIGNATURE_HEADER, signDummyWebhook } from '../src/providers/dummy-provider';
import { paymentProvider } from '../src/providers/providers';
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

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Moves a session's expiry to `ago` ms in the past. */
const expire = (sessionId: string, ago: number) => api.db.session.update({ where: { id: sessionId }, data: { expiresAt: new Date(Date.now() - ago) } });

/** Waits (up to 5 s) for the alert email whose text mentions `needle`. */
async function alertAbout(needle: string) {
  for (let i = 0; i < 250; i += 1) {
    const mail = mailOutbox.find((sent) => sent.text.includes(needle));
    if (mail) return mail;
    await pause(20);
  }
  throw new Error(`No alert about ${needle}`);
}

/** The session's notice once its first attempt is recorded (attempts happen after the product answers). */
async function firstAttempt(sessionId: string) {
  let notice = await api.db.notification.findFirstOrThrow({ where: { sessionId } });
  for (let i = 0; i < 250 && notice.attempts === 0; i += 1) {
    await pause(20);
    notice = await api.db.notification.findFirstOrThrow({ where: { sessionId } });
  }
  return notice;
}

describe('the service', () => {
  it('says what it is', async () => {
    const res = await api.request('GET', '/meta', { key: null });
    expect(res.body).toEqual({ service: 'checkout', provider: 'dummy' });
  });

  it('runs the test provider only where test payments are allowed', () => {
    process.env.CHECKOUT_ALLOW_TEST_PAYMENTS = '';
    try {
      expect(() => paymentProvider()).toThrow(/CHECKOUT_ALLOW_TEST_PAYMENTS=true/);
    } finally {
      process.env.CHECKOUT_ALLOW_TEST_PAYMENTS = 'true';
    }
    expect(paymentProvider().name).toBe('dummy');
  });

  it('needs alerts set up before a provider that moves real money', () => {
    expect(() => requireAlerts('razorpay')).not.toThrow();
    process.env.CHECKOUT_ALERT_EMAIL = '';
    try {
      expect(() => requireAlerts('razorpay')).toThrow(/CHECKOUT_ALERT_EMAIL and SMTP_URL/);
    } finally {
      process.env.CHECKOUT_ALERT_EMAIL = 'ops@example.com';
    }
    process.env.MAIL_TRANSPORT = '';
    try {
      expect(() => requireAlerts('razorpay')).toThrow(/CHECKOUT_ALERT_EMAIL and SMTP_URL/);
    } finally {
      process.env.MAIL_TRANSPORT = 'memory';
    }
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

  it('leaves the session open after a failed attempt, so the payer can try again', async () => {
    const session = await newSession();
    const ref = await providerRef(session.id);
    const failed = await api.request('POST', `/dummy/${ref}`, { key: null, form: { outcome: 'fail' } });
    expect(failed.text).toContain("That attempt didn't go through (Failed on the test page). Try again.");
    expect((await api.request('GET', `/sessions/${session.id}`)).body.status).toBe('pending');
    // The link still leads to the provider, and the product hears nothing of an attempt.
    expect((await api.request('GET', `/pay/${session.id}`, { key: null })).status).toBe(302);
    await pause(100);
    expect(pos.forSession(session.id)).toHaveLength(0);

    const paid = await api.request('POST', `/dummy/${ref}`, { key: null, form: { outcome: 'pay' } });
    expect(paid.text).toContain('Payment received');
    const notices = await pos.waitFor(session.id);
    expect(notices).toHaveLength(1);
    expect(JSON.parse(notices[0].body)).toMatchObject({ type: 'payment.succeeded', reason: null });
  });

  it('does not count a payment for the wrong amount: it is kept to refund, with an alert', async () => {
    const session = await newSession();
    const ref = await providerRef(session.id);
    const eventId = randomUUID();
    await dummyWebhook({ eventId, type: 'payment.succeeded', providerRef: ref, amount: 100 });
    expect((await api.request('GET', `/sessions/${session.id}`)).body.status).toBe('pending');
    expect(await api.db.uncountedPayment.findMany({ where: { sessionId: session.id } })).toMatchObject([
      { eventId, providerRef: ref, amount: 100, refundedAt: null, reason: `it was ₹1.00, not the ₹1,178.82 session ${session.id} asked for` }
    ]);
    const alert = await alertAbout(eventId);
    expect(alert).toMatchObject({ to: ['ops@example.com'], subject: "[checkout] Refund ₹1.00: a dummy payment that didn't count" });
    expect(alert.text).toContain(`Session ${session.id}: pos ${session.reference}`);
    expect(alert.text).toContain('UPDATE "UncountedPayment" SET "refundedAt" = now()');
    await pause(100);
    expect(pos.forSession(session.id)).toHaveLength(0);
  });
});

describe('expiry', () => {
  it('gives a session a day', async () => {
    const session = await newSession();
    const row = await api.db.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(Math.abs(row.expiresAt.getTime() - row.createdAt.getTime() - SESSION_LIFETIME_MS)).toBeLessThan(5000);
  });

  it('stops the link at expiry, but lets a payment already under way finish', async () => {
    const session = await newSession();
    const ref = await providerRef(session.id);
    await expire(session.id, 60_000);
    expect((await api.request('GET', `/pay/${session.id}`, { key: null })).text).toContain('This payment link has expired');
    expect((await api.request('GET', `/dummy/${ref}`, { key: null })).text).toContain('This payment link has expired');

    // The provider's page, opened before, still pays: the session waits for it a while.
    await api.jobs.run();
    const paid = await api.request('POST', `/dummy/${ref}`, { key: null, form: { outcome: 'pay' } });
    expect(paid.text).toContain('Payment received');
    expect(JSON.parse((await pos.waitFor(session.id))[0].body)).toMatchObject({ type: 'payment.succeeded' });
  });

  it('closes a session left unpaid, and tells the product why, once', async () => {
    const session = await newSession({ metadata: { plan: 'growth' } });
    const ref = await providerRef(session.id);
    await api.request('POST', `/dummy/${ref}`, { key: null, form: { outcome: 'fail' } });
    await expire(session.id, CLOSE_AFTER_EXPIRY_MS + 1000);
    await api.jobs.run();

    expect((await api.request('GET', `/sessions/${session.id}`)).body.status).toBe('failed');
    const [notice] = await pos.waitFor(session.id);
    expect(JSON.parse(notice.body)).toMatchObject({
      type: 'payment.failed',
      amount: 117882,
      reason: 'The payment link expired; the last attempt failed: Failed on the test page',
      metadata: { plan: 'growth' }
    });
    expect((await api.request('GET', `/pay/${session.id}`, { key: null })).text).toContain('This payment link has expired');

    // Its page takes nothing more, and running again changes nothing.
    await api.request('POST', `/dummy/${ref}`, { key: null, form: { outcome: 'pay' } });
    await api.jobs.run();
    expect((await api.request('GET', `/sessions/${session.id}`)).body.status).toBe('failed');
    await pause(100);
    expect(pos.forSession(session.id)).toHaveLength(1);
  });

  it('keeps a payment that lands after the session closed, to refund, with an alert', async () => {
    const session = await newSession();
    const ref = await providerRef(session.id);
    await expire(session.id, CLOSE_AFTER_EXPIRY_MS + 1000);
    await api.jobs.run();
    await pos.waitFor(session.id);

    const eventId = randomUUID();
    await dummyWebhook({ eventId, type: 'payment.succeeded', providerRef: ref, amount: session.amount });
    expect(await api.db.uncountedPayment.count({ where: { eventId } })).toBe(1);
    expect((await alertAbout(eventId)).text).toContain(`session ${session.id} had already closed unpaid (The payment link expired)`);
    expect((await api.request('GET', `/sessions/${session.id}`)).body.status).toBe('failed');
    await pause(100);
    expect(pos.forSession(session.id)).toHaveLength(1);
  });
});

describe('provider webhooks', () => {
  it('are refused without the provider signature, and for another provider', async () => {
    const res = await fetch(`${api.baseUrl}/webhooks/dummy`, { method: 'POST', headers: { [DUMMY_SIGNATURE_HEADER]: '0'.repeat(64) }, body: '{}' });
    expect(res.status).toBe(400);
    expect((await fetch(`${api.baseUrl}/webhooks/razorpay`, { method: 'POST', body: '{}' })).status).toBe(404);
  });

  it('keep money taken for a payment the service does not know, to refund, with an alert', async () => {
    const eventId = randomUUID();
    expect((await dummyWebhook({ eventId, type: 'payment.succeeded', providerRef: 'dummy_unknown', amount: 5000 })).status).toBe(200);
    expect(await api.db.uncountedPayment.findFirst({ where: { eventId } })).toMatchObject({ sessionId: null, amount: 5000 });
    expect((await alertAbout(eventId)).subject).toBe("[checkout] Refund ₹50.00: a dummy payment that didn't count");
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
    const waiting = await firstAttempt(session.id);
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

  it('raise an alert when the product never takes one', async () => {
    pos.answerWith(500);
    try {
      const session = await newSession();
      await api.request('POST', `/dummy/${await providerRef(session.id)}`, { key: null, form: { outcome: 'pay' } });
      await pos.waitFor(session.id);
      const notice = await firstAttempt(session.id);
      await api.db.notification.update({ where: { id: notice.id }, data: { attempts: MAX_ATTEMPTS - 1, nextAttemptAt: new Date() } });
      await api.notifications.deliverDue();

      expect(await api.db.notification.findUniqueOrThrow({ where: { id: notice.id } })).toMatchObject({ attempts: MAX_ATTEMPTS, deliveredAt: null });
      const alert = await alertAbout(notice.id);
      expect(alert.subject).toBe(`[checkout] pos never took notice ${notice.id} (payment.succeeded)`);
      expect(alert.text).toContain('answered 500');
      expect(alert.text).toContain(`UPDATE "Notification" SET attempts = 0, "nextAttemptAt" = now() WHERE id = '${notice.id}';`);

      // Then it's left alone.
      await api.notifications.deliverDue();
      expect(pos.forSession(session.id)).toHaveLength(2);
    } finally {
      pos.answerWith(200);
    }
  });

  it('wait longer after each failure, up to six hours', () => {
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(2)).toBe(60_000);
    expect(retryDelayMs(30)).toBe(6 * 60 * 60_000);
  });
});

describe('alerts', () => {
  it('wait, stored, while email is not set up, and go out once it is', async () => {
    const eventId = randomUUID();
    process.env.MAIL_TRANSPORT = '';
    try {
      await dummyWebhook({ eventId, type: 'payment.succeeded', providerRef: 'dummy_unknown_mail_off', amount: 700 });
      await pause(100);
      expect(await api.db.alert.findFirstOrThrow({ where: { text: { contains: eventId } } })).toMatchObject({ sentAt: null, attempts: 0 });
      expect(mailOutbox.some((mail) => mail.text.includes(eventId))).toBe(false);
    } finally {
      process.env.MAIL_TRANSPORT = 'memory';
    }
    await api.jobs.run();
    await alertAbout(eventId);
    expect(await api.db.alert.findFirstOrThrow({ where: { text: { contains: eventId } } })).toMatchObject({ sentAt: expect.any(Date), attempts: 1 });
  });

  it('are tried again later when the mail server fails', async () => {
    const eventId = randomUUID();
    process.env.MAIL_TRANSPORT = '';
    process.env.SMTP_URL = 'smtp://127.0.0.1:9';
    try {
      await dummyWebhook({ eventId, type: 'payment.succeeded', providerRef: 'dummy_unknown_mail_down', amount: 700 });
      let alert = await api.db.alert.findFirstOrThrow({ where: { text: { contains: eventId } } });
      for (let i = 0; i < 250 && alert.attempts === 0; i += 1) {
        await pause(20);
        alert = await api.db.alert.findFirstOrThrow({ where: { text: { contains: eventId } } });
      }
      expect(alert).toMatchObject({ sentAt: null, attempts: 1, lastError: expect.any(String) });
      expect(alert.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    } finally {
      process.env.MAIL_TRANSPORT = 'memory';
      delete process.env.SMTP_URL;
    }
  });
});
