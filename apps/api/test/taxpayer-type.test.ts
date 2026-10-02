import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addOpeningStock, checkoutBody, line, startApp, type TestApp } from './helpers';

// GST #30: the taxpayer type can change over time; each sale records the type it was made under,
// and a composition taxpayer charges no GST.
let t: TestApp;
let admin: string;
let ctx: Awaited<ReturnType<TestApp['branchWithRegister']>>;
let exclusive: { id: string };
let inclusive: { id: string };
let timezone: string;

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
const daysFromToday = (days: number) => {
  const [y, m, d] = today().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
const summary = () => t.ok('GET', '/business/taxpayer-type', admin);
const change = (body: Record<string, unknown>, token = admin) => t.call('POST', '/business/taxpayer-type', token, body);
const sell = (lines: unknown[], total: number, token = ctx.token, branchId = ctx.branch.id, customerId = ctx.walkIn.id) =>
  t.ok('POST', '/sales/checkout', token, checkoutBody(branchId, customerId, lines, [{ mode: 'CASH', amount: total }]));
const resetTaxpayerType = () => t.db.taxpayerTypeChange.deleteMany({});

beforeAll(async () => {
  t = await startApp();
  admin = await t.login();
  await resetTaxpayerType();
  await t.ok('PATCH', '/business/settings', admin, { cashierMaxDiscountPercent: 10 });
  timezone = (await t.ok('GET', '/business/settings', admin)).timezone;
  ctx = await t.branchWithRegister(admin);
  exclusive = await t.item(ctx.token, ctx.branch.id, { sellPrice: 100, taxRate: 18, taxMode: 'EXCLUSIVE' });
  inclusive = await t.item(ctx.token, ctx.branch.id, { sellPrice: 118, taxRate: 18, taxMode: 'INCLUSIVE' });
});
afterAll(async () => {
  await resetTaxpayerType();
  await t.close();
});

const exclusiveLine = () => line(exclusive.id, { rate: 100, taxRate: 18 });
const inclusiveLine = () => line(inclusive.id, { rate: 118, taxRate: 18, taxMode: 'INCLUSIVE' });

describe('taxpayer type', () => {
  it('starts regular, charging GST on a Tax Invoice', async () => {
    expect((await summary()).current).toEqual({ taxpayerType: 'REGULAR', compositionCategory: null, effectiveDate: null });
    expect((await t.ok('GET', '/business/settings', admin)).taxpayerType).toBe('REGULAR');
    const { invoice } = await sell([exclusiveLine(), inclusiveLine()], 236);
    expect(invoice).toMatchObject({ taxpayerType: 'REGULAR', documentType: 'TAX_INVOICE', compositionCategory: null });
    expect(Number(invoice.taxTotal)).toBe(36);
    expect(Number(invoice.grandTotal)).toBe(236);
  });

  it('rejects a backdated change, a missing or stray category, and a change to the current type', async () => {
    const yesterday = await change({ taxpayerType: 'COMPOSITION', compositionCategory: 'TRADER', effectiveDate: daysFromToday(-1) });
    expect(yesterday.status).toBe(400);
    expect(String(yesterday.body.message)).toMatch(/before today/);
    expect((await change({ taxpayerType: 'COMPOSITION', effectiveDate: today() })).status).toBe(400);
    expect((await change({ taxpayerType: 'REGULAR', compositionCategory: 'TRADER', effectiveDate: today() })).status).toBe(400);
    expect((await change({ taxpayerType: 'REGULAR', effectiveDate: today() })).body.message).toMatch(/already regular/);
    expect((await change({ taxpayerType: 'COMPOSITION', compositionCategory: 'TRADER', effectiveDate: '2026-02-30' })).status).toBe(400);
    expect((await summary()).history).toHaveLength(0);
  });

  it('only lets an admin change it', async () => {
    const c = await t.branchWithRegister(admin);
    const username = `gst-cashier-${Date.now()}`;
    await t.ok('POST', '/users', admin, { branchId: c.branch.id, username, password: 'cashier-pass-1' });
    const cashier = await t.login(username, 'cashier-pass-1');
    const res = await change({ taxpayerType: 'COMPOSITION', compositionCategory: 'TRADER', effectiveDate: today() }, cashier);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Admin role required');
  });

  it('schedules a later change without applying it, one at a time, and can cancel it', async () => {
    const date = daysFromToday(30);
    const res = await change({ taxpayerType: 'COMPOSITION', compositionCategory: 'TRADER', effectiveDate: date });
    expect(res.status).toBe(201);
    expect(res.body.current.taxpayerType).toBe('REGULAR');
    expect(res.body.scheduled).toMatchObject({ taxpayerType: 'COMPOSITION', compositionCategory: 'TRADER', effectiveDate: date });

    const { invoice } = await sell([exclusiveLine()], 118);
    expect(invoice.documentType).toBe('TAX_INVOICE');

    const second = await change({ taxpayerType: 'COMPOSITION', compositionCategory: 'RESTAURANT', effectiveDate: daysFromToday(40) });
    expect(second.status).toBe(400);
    expect(String(second.body.message)).toMatch(/already scheduled/);

    const cancelled = await t.ok('DELETE', `/business/taxpayer-type/${res.body.scheduled.id}`, admin);
    expect(cancelled.scheduled).toBeNull();
    expect(cancelled.history).toHaveLength(0);
  });

  it('as a composition taxpayer, charges no GST: a Bill of Supply at the shelf price', async () => {
    const before = await sell([exclusiveLine()], 118);
    const res = await change({ taxpayerType: 'COMPOSITION', compositionCategory: 'TRADER', effectiveDate: today() });
    expect(res.status).toBe(201);
    expect(res.body.current).toEqual({ taxpayerType: 'COMPOSITION', compositionCategory: 'TRADER', effectiveDate: today() });
    expect((await t.ok('GET', '/business/settings', admin)).compositionCategory).toBe('TRADER');

    // The exclusive item sells at 100 and the inclusive one at its shelf price of 118; no tax.
    const { invoice } = await sell([exclusiveLine(), inclusiveLine()], 218);
    expect(invoice).toMatchObject({ taxpayerType: 'COMPOSITION', documentType: 'BILL_OF_SUPPLY', compositionCategory: 'TRADER' });
    expect(Number(invoice.taxTotal)).toBe(0);
    expect(Number(invoice.subTotal)).toBe(218);
    expect(Number(invoice.grandTotal)).toBe(218);
    const lines = await t.db.saleInvoiceLine.findMany({ where: { invoiceId: invoice.id } });
    expect(lines.map((l) => [Number(l.taxRate), Number(l.taxAmount), Number(l.netAmount)]).sort()).toEqual([
      [0, 0, 100],
      [0, 0, 118]
    ]);

    // A sale made before the change keeps its type.
    const earlier = await t.ok('GET', `/sales/${before.invoice.id}`, ctx.token);
    expect(earlier).toMatchObject({ taxpayerType: 'REGULAR', documentType: 'TAX_INVOICE' });
    expect(Number(earlier.taxTotal)).toBe(18);
  });

  it("keeps the cashier discount limit on the price actually charged", async () => {
    // A cashier at 10%: 118 → 105 on the inclusive item is 11% off what a composition seller charges.
    const c = await t.branchWithRegister(admin);
    const username = `gst-limit-${Date.now()}`;
    await t.ok('POST', '/users', admin, { branchId: c.branch.id, username, password: 'cashier-pass-1' });
    await t.ok('POST', '/registers/close', c.token, { closingBalance: 0 });
    const cashier = await t.ok('POST', '/registers/open', await t.login(username, 'cashier-pass-1'), {
      branchId: c.branch.id,
      openingBalance: 0
    });
    await addOpeningStock(t.db, c.branch.id, inclusive.id, 10);
    const sale = (rate: number) =>
      t.call('POST', '/sales/checkout', cashier.token, checkoutBody(c.branch.id, c.walkIn.id, [{ ...inclusiveLine(), rate }], [{ mode: 'CASH', amount: rate }]));
    const tooMuch = await sale(105);
    expect(tooMuch.status).toBe(400);
    expect(String(tooMuch.body.message)).toMatch(/11\.02%/);
    expect((await sale(107)).status).toBe(200); // 9.32% off
  });

  it('switches back to regular from a later date', async () => {
    const date = daysFromToday(1);
    const res = await change({ taxpayerType: 'REGULAR', effectiveDate: date });
    expect(res.status).toBe(201);
    expect(res.body.current.taxpayerType).toBe('COMPOSITION');
    expect(res.body.scheduled).toMatchObject({ taxpayerType: 'REGULAR', compositionCategory: null, effectiveDate: date });
    // The scheduled change starts at midnight of its date in the business time zone.
    const startsAt = new Date(res.body.scheduled.effectiveFrom);
    expect(new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(startsAt)).toBe(date);
    expect(new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(startsAt.getTime() - 1))).toBe(today());

    // A change already in force can't be cancelled.
    const inForce = res.body.history.find((row: { effectiveDate: string }) => row.effectiveDate === today());
    expect((await t.call('DELETE', `/business/taxpayer-type/${inForce.id}`, admin)).status).toBe(400);
  });
});
