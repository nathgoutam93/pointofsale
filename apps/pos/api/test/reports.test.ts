import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, checkoutBody, line, startApp, type TestApp } from './helpers';

// #11: net sales, tax, cost of goods sold and gross profit. #15: periods in the business time zone.
let t: TestApp;
let admin: string;
beforeAll(async () => { t = await startApp(); admin = await t.login(); });
afterAll(async () => {
  await t.call('PATCH', '/business/settings', admin, { timezone: 'Asia/Kolkata' });
  await t.close();
});

const overall = async (token: string, branchId: string) =>
  (await t.ok('GET', `/reports/sales-summary?branchId=${branchId}`, token)).ranges.find((r: { label: string }) => r.label === 'Overall');

describe('sales summary', () => {
  it("lets an admin report on other branches they can access, but not on ones they can't", async () => {
    const here = await t.branchWithRegister(admin);
    const other = await t.branchWithRegister(admin);
    // The admin's register is open in `here`; another branch they can access is still reportable.
    expect((await t.call('GET', `/reports/sales-summary?branchId=${other.branch.id}`, here.token)).status).toBe(200);

    const adminUser = await t.db.user.findUniqueOrThrow({ where: { username: ADMIN.username } });
    await t.db.userBranchAccess.delete({ where: { userId_branchId: { userId: adminUser.id, branchId: other.branch.id } } });
    const denied = await t.call('GET', `/reports/sales-summary?branchId=${other.branch.id}`, here.token);
    expect(denied.status).toBe(403);
    expect(denied.body.message).toBe('You do not have access to this branch');
  });

  it('reports gross profit from net sales and the cost recorded when sold', async () => {
    const ctx = await t.branchWithRegister(admin);
    const a = await t.item(ctx.token, ctx.branch.id, { sellPrice: 100, costPrice: 60, taxRate: 18, stock: 1000 });
    const b = await t.item(ctx.token, ctx.branch.id, { sellPrice: 118, costPrice: 50, taxRate: 18, taxMode: 'INCLUSIVE', stock: 100 });
    const customer = await t.ok('POST', '/customers', ctx.token, { branchId: ctx.branch.id, name: 'Credit' });
    const la = (qty: number) => line(a.id, { qty, taxRate: 18 });
    const s1 = await t.ok('POST', '/sales/checkout', ctx.token, checkoutBody(ctx.branch.id, ctx.walkIn.id, [la(2)], [{ mode: 'CASH', amount: 236 }]));
    await t.ok('POST', '/sales/checkout', ctx.token, checkoutBody(ctx.branch.id, ctx.walkIn.id, [line(b.id, { rate: 118, taxRate: 18, taxMode: 'INCLUSIVE' })], [{ mode: 'CARD', amount: 118 }]));
    const credit = await t.ok('POST', '/sales/checkout', ctx.token, checkoutBody(ctx.branch.id, customer.id, [la(1)], []));
    const draft = await t.ok('POST', '/sales', ctx.token, { branchId: ctx.branch.id, customerId: customer.id, lines: [la(5)] });
    await t.ok('POST', `/sales/${draft.id}/cancel`, ctx.token, { reason: 'Test cancel' });
    await t.ok('POST', `/sales/${s1.invoice.id}/return`, ctx.token, { lines: [{ saleLineId: s1.invoice.lines[0].id, qty: 1 }], refundMode: 'CASH', reason: 'Test return' });

    // The credit sale counts as a sale (its goods are gone); the cancelled one doesn't.
    const before = {
      invoiceCount: 3,
      grossSales: 472,
      taxCollected: 72,
      returnsGross: 118,
      returnsNet: 100,
      netSales: 300,
      costOfGoodsSold: 170,
      grossProfit: 130,
      unpaidSales: 118,
      collections: { cash: 236, card: 118, upi: 0, wallet: 0 }
    };
    expect(await overall(ctx.token, ctx.branch.id)).toMatchObject(before);

    // Changing the cost later doesn't rewrite past profit.
    await t.ok('PATCH', `/items/${a.id}`, ctx.token, { costPrice: 80 });
    expect((await overall(ctx.token, ctx.branch.id)).costOfGoodsSold).toBe(170);

    // Paying the credit bill later doesn't change the sales; it is money collected (by UPI here).
    await t.ok('POST', `/sales/${credit.invoice.id}/settle`, ctx.token, { idempotencyKey: randomUUID(), payments: [{ mode: 'UPI', amount: 118 }] });
    expect(await overall(ctx.token, ctx.branch.id)).toMatchObject({
      ...before,
      unpaidSales: 0,
      collections: { cash: 236, card: 118, upi: 118, wallet: 0 }
    });
  });

  it('works out Today in the business time zone', async () => {
    const ctx = await t.branchWithRegister(admin);
    const item = await t.item(ctx.token, ctx.branch.id);
    const sell = async (rate: number) =>
      (await t.ok('POST', '/sales/checkout', ctx.token, checkoutBody(ctx.branch.id, ctx.walkIn.id, [line(item.id, { rate })], [{ mode: 'CASH', amount: rate }]))).invoice;
    const today = async () => (await t.ok('GET', `/reports/sales-summary?branchId=${ctx.branch.id}`, ctx.token)).ranges[0];
    const hour = 60 * 60 * 1000;

    await t.ok('PATCH', '/business/settings', admin, { timezone: 'Asia/Kolkata' });
    const istStart = Date.parse((await today()).startDate);
    const now = new Date();
    const utcStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    // Kolkata is 5:30 ahead, so its day starts either 5.5 h before UTC's or, late in the UTC
    // evening, 18.5 h after. Pick one sale that is "today" only in Kolkata and one only in UTC.
    const kolkataOnly = utcStart > istStart ? istStart + hour : istStart + 23 * hour;
    const utcOnly = utcStart > istStart ? istStart + 25 * hour : istStart - hour;
    const a = await sell(60);
    const b = await sell(40);
    await t.db.saleInvoice.update({ where: { id: a.id }, data: { createdAt: new Date(kolkataOnly) } });
    await t.db.saleInvoice.update({ where: { id: b.id }, data: { createdAt: new Date(utcOnly) } });

    expect((await today()).grossSales).toBe(60);
    await t.ok('PATCH', '/business/settings', admin, { timezone: 'UTC' });
    const utc = await today();
    expect(utc.startDate).toBe(new Date(utcStart).toISOString());
    expect(utc.grossSales).toBe(40);

    expect((await t.call('PATCH', '/business/settings', admin, { timezone: 'Mars/Olympus_Mons' })).status).toBe(400);
  });
});
