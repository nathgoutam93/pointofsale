import { randomUUID } from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addBillingPeriod, GRACE_DAYS, PAYMENT_REQUIRED, PLAN_LIMIT_REACHED, TRIAL_DAYS } from '@pos/contracts';
import { paidPeriod } from '../src/billing/billing.service';
import { DummyGateway } from '../src/billing/dummy-gateway';
import { fiscalYearOf, invoiceNumber, splitSubscriptionGst } from '../src/billing/invoice';
import { BillingReminders, reminderFor } from '../src/billing/reminders';
import { mailOutbox } from '../src/mail/mailer';
import { TenancyService } from '../src/tenancy/tenancy.service';
import { startApp, type TestApp } from './helpers';

// Subscriptions on managed hosting, with the dummy gateway standing in for a real one.
const DAY = 24 * 60 * 60 * 1000;
const OWNER = { email: `billing-${randomUUID().slice(0, 8)}@example.com`, password: 'owner-pass-1' };
const ADMIN = { username: 'admin', password: 'shop-admin-1' };

let t: TestApp;
let business: { id: string; code: string };
let admin: string;

const control = () => t.app.get(TenancyService).control;
/** Changes the business's billing directly, as time passing would. */
async function setBilling(data: { plan?: string; trialEndsAt?: Date | null; paidUntil?: Date | null }) {
  await control().business.update({ where: { id: business.id }, data });
  t.app.get(TenancyService).forget(business.id);
}
const billingRow = () => control().business.findUniqueOrThrow({ where: { id: business.id }, select: { plan: true, trialEndsAt: true, paidUntil: true } });

async function signIn() {
  return (await t.ok<{ token: string }>('POST', '/auth/login', null, { businessCode: business.code, ...ADMIN })).token;
}

/** Starts paying and follows the payment link to the dummy gateway's page, as a browser would. */
async function startPayment(plan: string, period: string) {
  const started = await t.ok<{ checkoutId: string; payPath: string }>('POST', '/billing/checkout', admin, { plan, period });
  const pay = await fetch(t.baseUrl + started.payPath, { redirect: 'manual' });
  expect(pay.status).toBe(302);
  const page = new URL(pay.headers.get('location')!, t.baseUrl + started.payPath);
  return { ...started, page: page.toString(), ref: page.pathname.split('/').pop()! };
}

const press = (page: string, outcome: 'paid' | 'failed') =>
  fetch(page, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `outcome=${outcome}` });

beforeAll(async () => {
  process.env.MAIL_TRANSPORT = 'memory';
  t = await startApp();
  const created = await t.ok<{ business: { id: string; code: string } }>('POST', '/businesses', null, {
    ownerEmail: OWNER.email,
    ownerPassword: OWNER.password,
    businessName: 'Billing Stores',
    adminUsername: ADMIN.username,
    adminPassword: ADMIN.password
  });
  business = created.business;
  admin = await signIn();
});
afterAll(async () => {
  delete process.env.POS_HOSTING;
  delete process.env.BILLING_GATEWAY;
  delete process.env.MAIL_TRANSPORT;
  await t.close();
});
beforeEach(() => {
  process.env.POS_HOSTING = 'managed';
  process.env.BILLING_GATEWAY = 'dummy';
  mailOutbox.length = 0;
});

describe('where billing applies', () => {
  it('exists only on managed hosting', async () => {
    delete process.env.POS_HOSTING;
    expect((await t.call('GET', '/billing/status', admin)).status).toBe(404);
    expect((await t.call('POST', '/billing/webhooks/dummy', null, {})).status).toBe(404);
  });

  it("isn't enforced without a gateway: no payments, no limits, no read-only", async () => {
    delete process.env.BILLING_GATEWAY;
    expect(await t.ok('GET', '/billing/status', admin)).toMatchObject({ enforced: false });
    expect((await t.call('POST', '/billing/checkout', admin, { plan: 'starter', period: 'month' })).status).toBe(503);
    await setBilling({ trialEndsAt: new Date(Date.now() - 60 * DAY) });
    try {
      const [branch] = await t.ok<Array<{ id: string }>>('GET', '/branches', admin);
      expect((await t.call('PATCH', `/branches/${branch.id}`, admin, { receiptPrefix: 'RCPT' })).status).toBe(200);
    } finally {
      await setBilling({ trialEndsAt: new Date(Date.now() + TRIAL_DAYS * DAY) });
    }
  });
});

describe('a new business', () => {
  it('starts on a trial of the Growth plan', async () => {
    const status = await t.ok('GET', '/billing/status', admin);
    expect(status).toMatchObject({ enforced: true, state: 'trial', plan: 'growth' });
    const ends = new Date(status.endsAt).getTime();
    expect(Math.abs(ends - (Date.now() + TRIAL_DAYS * DAY))).toBeLessThan(5 * 60 * 1000);
    expect(new Date(status.graceEndsAt).getTime() - ends).toBe(GRACE_DAYS * DAY);
  });

  it('shows admins the plans, prices, usage and the test gateway', async () => {
    const summary = await t.ok('GET', '/billing', admin);
    expect(summary).toMatchObject({ paymentsEnabled: true, gateway: 'dummy', gstRate: 0, usage: { branches: 1, counters: 1 }, invoices: [] });
    expect(summary.gatewayNote).toMatch(/no money/);
    expect(summary.plans.map((plan: { code: string }) => plan.code)).toEqual(['starter', 'growth', 'business']);
    expect(summary.plans[0].prices.month).toEqual({ amount: 49_900, gst: 0, total: 49_900 });
  });

  it('charges GST when we are registered', async () => {
    process.env.BILLING_SELLER_GSTIN = '29ABCDE1234F1Z5';
    try {
      const summary = await t.ok('GET', '/billing', admin);
      expect(summary.gstRate).toBe(18);
      expect(summary.plans[0].prices.month).toEqual({ amount: 49_900, gst: 8_982, total: 58_882 });
    } finally {
      delete process.env.BILLING_SELLER_GSTIN;
    }
  });
});

describe('plan limits', () => {
  it('caps branches and active counters, and turning a counter back on counts', async () => {
    await setBilling({ plan: 'starter' });
    try {
      const [branch] = await t.ok<Array<{ id: string }>>('GET', '/branches', admin);
      const second = await t.ok<{ id: string }>('POST', `/branches/${branch.id}/counters`, admin, { name: 'Till 2' });
      const third = await t.call('POST', `/branches/${branch.id}/counters`, admin, { name: 'Till 3' });
      expect(third.status).toBe(403);
      expect(third.body).toMatchObject({ code: PLAN_LIMIT_REACHED, message: expect.stringMatching(/Starter plan allows 2 counters/) });
      const branchRefused = await t.call('POST', '/branches', admin, { name: 'Second shop', code: 'SEC' });
      expect(branchRefused.status).toBe(403);
      expect(branchRefused.body.message).toMatch(/allows 1 branch\./);

      await t.ok('PATCH', `/counters/${second.id}`, admin, { isActive: false });
      await t.ok('POST', `/branches/${branch.id}/counters`, admin, { name: 'Till 3' });
      expect((await t.call('PATCH', `/counters/${second.id}`, admin, { isActive: true })).body.code).toBe(PLAN_LIMIT_REACHED);
    } finally {
      await setBilling({ plan: 'growth' });
    }
  });
});

describe('paying through the dummy gateway', () => {
  it('counts a payment only from the webhook, from the end of the trial, with an invoice and an email', async () => {
    const before = await billingRow();
    const { page, payPath } = await startPayment('growth', 'month');
    expect((await billingRow()).paidUntil).toBeNull();

    const shown = await fetch(page);
    expect(shown.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(await shown.text()).toMatch(/Pay ₹999\.00[\s\S]*no money is taken/);

    expect(await (await press(page, 'paid')).text()).toMatch(/Payment received/);
    const after = await billingRow();
    expect(after.paidUntil).toEqual(addBillingPeriod(before.trialEndsAt!, 'month'));
    expect(await t.ok('GET', '/billing/status', admin)).toMatchObject({ state: 'active', plan: 'growth' });

    const summary = await t.ok('GET', '/billing', admin);
    expect(summary.invoices).toHaveLength(1);
    const [listed] = summary.invoices;
    expect(listed).toMatchObject({ plan: 'growth', period: 'month', total: 99_900 });
    expect(listed.number).toBe(invoiceNumber(fiscalYearOf(new Date()), 1));
    const invoice = await t.ok('GET', `/billing/invoices/${listed.id}`, admin);
    expect(invoice.html).toMatch(/Receipt[\s\S]*Billing Stores[\s\S]*Growth plan, 1 month/);

    expect(mailOutbox.map((mail) => [mail.to, mail.subject])).toEqual([[OWNER.email, expect.stringMatching(/^Payment received: Billing Stores is paid until/)]]);
    expect(mailOutbox[0].html).toContain(listed.number);

    // The link again: already paid, nothing more happens.
    const again = await fetch(t.baseUrl + payPath, { redirect: 'manual' });
    expect(again.status).toBe(200);
    expect(await again.text()).toMatch(/Already paid/);
    expect(await (await fetch(page)).text()).toMatch(/Already paid/);
  });

  it('a failed payment changes nothing and tells the owner', async () => {
    const before = await billingRow();
    const { page } = await startPayment('business', 'year');
    expect(await (await press(page, 'failed')).text()).toMatch(/didn&#39;t go through/);
    expect(await billingRow()).toEqual(before);
    expect(mailOutbox.map((mail) => mail.subject)).toEqual([expect.stringMatching(/didn't go through/)]);
  });

  it('refuses unsigned webhooks, counts a retried one once and a wrong amount never', async () => {
    const { ref, checkoutId } = await startPayment('growth', 'month');
    const before = await billingRow();
    const gateway = new DummyGateway();
    const event = gateway.webhookFor({ type: 'payment.succeeded', gatewayRef: ref, amount: 99_900 });
    const deliver = (body: Buffer, headers: Record<string, string>) =>
      fetch(`${t.baseUrl}/billing/webhooks/dummy`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });

    expect((await deliver(event.body, { 'x-dummy-signature': '0'.repeat(64) })).status).toBe(400);
    expect((await deliver(Buffer.from(event.body.toString().replace('99900', '1')), event.headers)).status).toBe(400);
    expect((await billingRow()).paidUntil).toEqual(before.paidUntil);

    expect((await deliver(event.body, event.headers)).status).toBe(200);
    const paid = await billingRow();
    expect(paid.paidUntil).toEqual(addBillingPeriod(before.paidUntil!, 'month'));
    expect((await deliver(event.body, event.headers)).status).toBe(200);
    expect(await billingRow()).toEqual(paid);

    // Signed, but for less than the checkout's total: not counted.
    const short = await startPayment('growth', 'month');
    const cheap = gateway.webhookFor({ type: 'payment.succeeded', gatewayRef: short.ref, amount: 100 });
    expect((await deliver(cheap.body, cheap.headers)).status).toBe(200);
    expect(await billingRow()).toEqual(paid);
    const checkouts = await control().billingCheckout.findMany({ where: { id: { in: [checkoutId, short.checkoutId] } }, select: { id: true, status: true } });
    expect(Object.fromEntries(checkouts.map((c) => [c.id, c.status]))).toEqual({ [checkoutId]: 'PAID', [short.checkoutId]: 'FAILED' });
  });

  it('only the gateway in use takes webhooks', async () => {
    expect((await t.call('POST', '/billing/webhooks/razorpay', null, {})).status).toBe(404);
  });
});

describe('when the subscription has ended', () => {
  let branchId: string;
  let register: string;

  beforeAll(async () => {
    process.env.POS_HOSTING = 'managed';
    process.env.BILLING_GATEWAY = 'dummy';
    branchId = (await t.ok<Array<{ id: string }>>('GET', '/branches', admin))[0].id;
    const counters = await t.ok<Array<{ id: string; isActive: boolean }>>('GET', `/branches/${branchId}/counters`, admin);
    const counterId = counters.find((counter) => counter.isActive)!.id;
    register = (await t.ok<{ token: string }>('POST', '/registers/open', admin, { branchId, counterId, openingBalance: 0 })).token;
    await setBilling({ trialEndsAt: new Date(Date.now() - 40 * DAY), paidUntil: new Date(Date.now() - (GRACE_DAYS + 1) * DAY) });
  });

  it('keeps working during the grace period', async () => {
    await setBilling({ paidUntil: new Date(Date.now() - DAY) });
    expect(await t.ok('GET', '/billing/status', admin)).toMatchObject({ state: 'past_due' });
    expect((await t.call('PATCH', `/branches/${branchId}`, admin, { receiptPrefix: 'RCPT' })).status).toBe(200);
    await setBilling({ paidUntil: new Date(Date.now() - (GRACE_DAYS + 1) * DAY) });
  });

  it('is read-only after it: reading, signing in, closing the register and paying still work', async () => {
    expect(await t.ok('GET', '/billing/status', admin)).toMatchObject({ state: 'read_only' });
    const refused = await t.call('PATCH', `/branches/${branchId}`, admin, { receiptPrefix: 'RCPT' });
    expect(refused.status).toBe(402);
    expect(refused.body).toMatchObject({ code: PAYMENT_REQUIRED, message: expect.stringMatching(/Settings → Billing/) });
    expect((await t.call('POST', '/branches', admin, { name: 'More', code: 'MOR' })).status).toBe(402);
    expect((await t.call('GET', '/items', admin)).status).toBe(200);
    expect((await t.call('POST', '/registers/close', register, { closingBalance: 0 })).status).toBe(200);
    // Signing in still works (and picks up no register now).
    admin = await signIn();

    const { page } = await startPayment('starter', 'month');
    await press(page, 'paid');
    const now = Date.now();
    const row = await billingRow();
    expect(row.plan).toBe('starter');
    // Nothing left to carry over: a month from now.
    expect(Math.abs(row.paidUntil!.getTime() - addBillingPeriod(new Date(now), 'month').getTime())).toBeLessThan(60_000);
    expect((await t.call('PATCH', `/branches/${branchId}`, admin, { receiptPrefix: 'RCPT' })).status).toBe(200);
  });
});

describe('reminders', () => {
  it('emails each one once, and a payment starts afresh', async () => {
    const reminders = t.app.get(BillingReminders);
    await setBilling({ trialEndsAt: new Date(Date.now() - DAY), paidUntil: new Date(Date.now() + 2 * DAY) });
    await reminders.sendDue();
    expect(mailOutbox.filter((mail) => mail.to === OWNER.email).map((mail) => mail.subject)).toEqual([
      expect.stringMatching(/^Billing Stores: the subscription ends on/)
    ]);
    mailOutbox.length = 0;
    await reminders.sendDue();
    expect(mailOutbox.filter((mail) => mail.to === OWNER.email)).toEqual([]);
  });

  it('follows the trial, the grace period and read-only', () => {
    const now = new Date('2026-10-03T00:00:00Z');
    const at = (days: number) => new Date(now.getTime() + days * DAY);
    const about = (trialEndsAt: Date, paidUntil: Date | null = null) => reminderFor({ name: 'Shop', trialEndsAt, paidUntil }, now);
    expect(about(at(5))).toBeNull();
    expect(about(at(2))?.subject).toMatch(/free trial ends/);
    expect(about(at(-1))?.subject).toMatch(/payment due by/);
    expect(about(at(-GRACE_DAYS - 1))?.subject).toMatch(/read-only/);
    expect(about(at(-30), at(10))).toBeNull();
  });
});

describe('the time a payment buys', () => {
  const now = new Date('2026-10-03T00:00:00Z');
  const at = (days: number) => new Date(now.getTime() + days * DAY);

  it('starts after the trial or the time already paid', () => {
    expect(paidPeriod({ plan: 'growth', trialEndsAt: at(5), paidUntil: null }, 'growth', 'month', now).periodFrom).toEqual(at(5));
    expect(paidPeriod({ plan: 'growth', trialEndsAt: at(-50), paidUntil: at(20) }, 'growth', 'year', now)).toEqual({
      periodFrom: at(20),
      periodTo: addBillingPeriod(at(20), 'year')
    });
    expect(paidPeriod({ plan: 'growth', trialEndsAt: at(-50), paidUntil: at(-20) }, 'growth', 'month', now).periodFrom).toEqual(now);
  });

  it('carries paid time over to a new plan at its price', () => {
    // 20 days of Growth (₹999) are worth 8 days of Business (₹2,499) and 40 of Starter (₹499).
    const growth = { plan: 'growth', trialEndsAt: at(-50), paidUntil: at(20) };
    expect(paidPeriod(growth, 'business', 'month', now).periodFrom.getTime() - now.getTime()).toBeCloseTo((20 * DAY * 99_900) / 2_49_900, -3);
    expect(paidPeriod(growth, 'starter', 'month', now).periodFrom.getTime() - now.getTime()).toBeCloseTo((20 * DAY * 99_900) / 49_900, -3);
    // On a trial, nothing paid: the new plan's time starts after the trial.
    expect(paidPeriod({ plan: 'growth', trialEndsAt: at(5), paidUntil: null }, 'starter', 'month', now).periodFrom).toEqual(at(5));
  });
});

describe('invoices', () => {
  it('are numbered per financial year, and split GST by state', () => {
    expect(fiscalYearOf(new Date('2027-03-31T18:00:00Z'))).toBe(2026); // 31 March, 11:30 pm IST
    expect(fiscalYearOf(new Date('2027-03-31T18:31:00Z'))).toBe(2027); // 1 April in IST
    expect(invoiceNumber(2026, 42)).toBe('POS/26-27/00042');
    process.env.BILLING_SELLER_GSTIN = '29ABCDE1234F1Z5';
    try {
      expect(splitSubscriptionGst(8_983, '29')).toEqual({ cgst: 4_491, sgst: 4_492, igst: 0 });
      expect(splitSubscriptionGst(8_983, null)).toEqual({ cgst: 4_491, sgst: 4_492, igst: 0 });
      expect(splitSubscriptionGst(8_983, '27')).toEqual({ cgst: 0, sgst: 0, igst: 8_983 });
    } finally {
      delete process.env.BILLING_SELLER_GSTIN;
    }
  });
});
