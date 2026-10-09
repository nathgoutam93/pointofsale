import { randomUUID } from 'crypto';
import { createServer, type Server } from 'http';
import { CHECKOUT_SIGNATURE_HEADER, type CheckoutNotification, signNotification } from '@hackd/checkout-contracts';
import { addBillingPeriod } from '@pos/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mailOutbox } from '../src/mail/mailer';
import { TenancyService } from '../src/tenancy/tenancy.service';
import { startApp, type TestApp } from './helpers';

// Subscriptions paid through our checkout service (apps/checkout), here a stand-in that answers
// as the real one does (@hackd/checkout-contracts).
const API_KEY = 'pos-api-key-for-tests-0123456789abcdef';
const NOTIFY_SECRET = 'pos-notify-secret-for-tests-0123456789';
const OWNER = { email: `checkout-${randomUUID().slice(0, 8)}@example.com`, password: 'owner-pass-1' };
const ADMIN = { username: 'admin', password: 'shop-admin-1' };

let t: TestApp;
let business: { id: string; code: string };
let admin: string;
let service: Server;
let serviceUrl: string;
/** What the stand-in service was asked, and how it answers (201 unless a test says otherwise). */
const asked: Array<{ authorization?: string; body: any }> = [];
let answer = 201;

const control = () => t.app.get(TenancyService).control;
const billingRow = () => control().business.findUniqueOrThrow({ where: { id: business.id }, select: { paidUntil: true, trialEndsAt: true } });

/** A notice as the checkout service sends it, signed with the POS's notify secret. */
function notice(sessionId: string, reference: string, overrides: Partial<CheckoutNotification> = {}) {
  const body: CheckoutNotification = {
    id: `evt_${randomUUID()}`,
    type: 'payment.succeeded',
    sessionId,
    product: 'pos',
    reference,
    amount: 99_900,
    currency: 'INR',
    reason: null,
    metadata: {},
    occurredAt: new Date().toISOString(),
    ...overrides
  };
  const raw = JSON.stringify(body);
  return { raw, headers: { 'content-type': 'application/json', [CHECKOUT_SIGNATURE_HEADER]: signNotification(NOTIFY_SECRET, raw) } };
}

const deliver = (sent: { raw: string; headers: Record<string, string> }) =>
  fetch(`${t.baseUrl}/billing/webhooks/checkout`, { method: 'POST', headers: sent.headers, body: sent.raw });

/** Starts paying: the POS asks the checkout service for a session and sends the payer to its page. */
async function startPayment() {
  const started = await t.ok<{ checkoutId: string; payPath: string }>('POST', '/billing/checkout', admin, { plan: 'growth', period: 'month' });
  const sessionId = `ses_${started.checkoutId}`;
  return { ...started, sessionId };
}

beforeAll(async () => {
  service = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
      asked.push({ authorization: req.headers.authorization, body });
      res.statusCode = answer;
      res.setHeader('content-type', 'application/json');
      if (answer !== 201) {
        res.end(JSON.stringify({ message: 'down' }));
        return;
      }
      res.end(
        JSON.stringify({
          id: `ses_${body.reference}`,
          product: 'pos',
          reference: body.reference,
          amount: body.amount,
          currency: 'INR',
          status: 'pending',
          payUrl: `https://api.example.com/v1/checkout/pay/ses_${body.reference}`,
          createdAt: new Date().toISOString(),
          paidAt: null
        })
      );
    });
  });
  await new Promise<void>((resolve) => service.listen(0, '127.0.0.1', resolve));
  const address = service.address();
  serviceUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

  process.env.MAIL_TRANSPORT = 'memory';
  t = await startApp();
  const created = await t.ok<{ business: { id: string; code: string } }>('POST', '/businesses', null, {
    ownerEmail: OWNER.email,
    ownerPassword: OWNER.password,
    businessName: 'Checkout Stores',
    adminUsername: ADMIN.username,
    adminPassword: ADMIN.password
  });
  business = created.business;
  admin = (await t.ok<{ token: string }>('POST', '/auth/login', null, { businessCode: business.code, ...ADMIN })).token;
});

afterAll(async () => {
  for (const name of ['POS_HOSTING', 'BILLING_GATEWAY', 'MAIL_TRANSPORT', 'CHECKOUT_URL', 'CHECKOUT_API_KEY', 'CHECKOUT_NOTIFY_SECRET']) {
    delete process.env[name];
  }
  await t.close();
  await new Promise<void>((resolve) => service.close(() => resolve()));
});

beforeEach(() => {
  process.env.POS_HOSTING = 'managed';
  process.env.BILLING_GATEWAY = 'checkout';
  process.env.CHECKOUT_URL = `${serviceUrl}/`;
  process.env.CHECKOUT_API_KEY = API_KEY;
  process.env.CHECKOUT_NOTIFY_SECRET = NOTIFY_SECRET;
  answer = 201;
  mailOutbox.length = 0;
});

describe('paying through the checkout service', () => {
  it('starts a session there with the API key and sends the payer to its page', async () => {
    const { checkoutId, payPath, sessionId } = await startPayment();
    const request = asked.at(-1)!;
    expect(request.authorization).toBe(`Bearer ${API_KEY}`);
    expect(request.body).toEqual({
      reference: checkoutId,
      amount: 99_900,
      currency: 'INR',
      description: 'Point of Sale, Growth plan, 1 month',
      customer: { email: OWNER.email },
      metadata: { businessCode: business.code }
    });
    const pay = await fetch(t.baseUrl + payPath, { redirect: 'manual' });
    expect(pay.status).toBe(302);
    expect(pay.headers.get('location')).toBe(`https://api.example.com/v1/checkout/pay/${sessionId}`);
  });

  it("counts a payment from the service's signed notice, once", async () => {
    const before = await billingRow();
    const { checkoutId, sessionId } = await startPayment();
    const paid = notice(sessionId, checkoutId);

    expect((await deliver(paid)).status).toBe(200);
    const after = await billingRow();
    expect(after.paidUntil).toEqual(addBillingPeriod(before.paidUntil ?? before.trialEndsAt!, 'month'));
    expect(mailOutbox.map((mail) => mail.subject)).toEqual([expect.stringMatching(/^Payment received/)]);

    // The service sends a notice again until it hears back: the same id counts once.
    expect((await deliver(paid)).status).toBe(200);
    expect(await billingRow()).toEqual(after);
  });

  it('refuses notices without the right signature, or too old to trust', async () => {
    const before = await billingRow();
    const { checkoutId, sessionId } = await startPayment();
    const paid = notice(sessionId, checkoutId);
    const forged = { raw: paid.raw, headers: { ...paid.headers, [CHECKOUT_SIGNATURE_HEADER]: signNotification('another-secret', paid.raw) } };
    expect((await deliver(forged)).status).toBe(400);
    const old = { raw: paid.raw, headers: { ...paid.headers, [CHECKOUT_SIGNATURE_HEADER]: signNotification(NOTIFY_SECRET, paid.raw, Math.floor(Date.now() / 1000) - 3600) } };
    expect((await deliver(old)).status).toBe(400);
    const changed = { raw: paid.raw.replace('99900', '1'), headers: paid.headers };
    expect((await deliver(changed)).status).toBe(400);
    expect(await billingRow()).toEqual(before);
  });

  it('a failed payment changes nothing and tells the owner', async () => {
    const before = await billingRow();
    const { checkoutId, sessionId } = await startPayment();
    expect((await deliver(notice(sessionId, checkoutId, { type: 'payment.failed', reason: 'Card declined' }))).status).toBe(200);
    expect(await billingRow()).toEqual(before);
    expect(mailOutbox.map((mail) => mail.subject)).toEqual([expect.stringMatching(/didn't go through/)]);
    const checkout = await control().billingCheckout.findUniqueOrThrow({ where: { id: checkoutId }, select: { status: true } });
    expect(checkout.status).toBe('FAILED');
  });

  it("says so when the service can't start a payment", async () => {
    answer = 503;
    const res = await t.call('POST', '/billing/checkout', admin, { plan: 'growth', period: 'month' });
    expect(res.status).toBe(503);
  });
});
