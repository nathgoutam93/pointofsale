import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkoutBody, line, startApp, type TestApp } from './helpers';

// #8: returns only on paid invoices, never refunding more than was charged.
let t: TestApp;
let ctx: Awaited<ReturnType<TestApp['branchWithRegister']>>;
let itemId: string;
let customerId: string;
beforeAll(async () => {
  t = await startApp();
  ctx = await t.branchWithRegister(await t.login());
  itemId = (await t.item(ctx.token, ctx.branch.id, { stock: 1000 })).id;
  customerId = (await t.ok('POST', '/customers', ctx.token, { branchId: ctx.branch.id, name: 'Returns customer' })).id;
});
afterAll(async () => { await t.close(); });

const paidSale = async (qty: number, discounts: unknown[] = []) =>
  (await t.ok('POST', '/sales/checkout', ctx.token, checkoutBody(ctx.branch.id, customerId, [line(itemId, { qty })], [{ mode: 'CASH', amount: qty * 100 - (discounts.length ? 100 : 0) }], { discounts }))).invoice;
const ret = (invoice: { id: string }, lines: unknown[], refundMode = 'CASH') =>
  t.call('POST', `/sales/${invoice.id}/return`, ctx.token, { lines, refundMode });

describe('returns', () => {
  it('refuses unpaid, part-paid and cancelled invoices, leaving stock alone', async () => {
    const unpaid = await t.ok('POST', '/sales', ctx.token, { branchId: ctx.branch.id, customerId, lines: [line(itemId)] });
    const cancelled = await paidSale(1);
    await t.db.saleInvoice.update({ where: { id: cancelled.id }, data: { status: 'CANCELLED' } });
    const stock = await t.onHand(ctx.token, ctx.branch.id, itemId);
    expect((await ret(unpaid, [{ saleLineId: unpaid.lines[0].id, qty: 1 }])).status).toBe(400);
    await t.ok('POST', `/sales/${unpaid.id}/settle`, ctx.token, { payments: [{ mode: 'CASH', amount: 40 }] });
    expect((await ret(unpaid, [{ saleLineId: unpaid.lines[0].id, qty: 1 }])).status).toBe(400);
    expect((await ret(cancelled, [{ saleLineId: cancelled.lines[0].id, qty: 1 }])).status).toBe(400);
    expect(await t.onHand(ctx.token, ctx.branch.id, itemId)).toBe(stock);
  });

  it('refunds a ₹200 line of 3 unit by unit as exactly ₹200, and no more', async () => {
    const sale = await paidSale(3, [{ type: 'FIXED', value: 100 }]);
    const amounts: number[] = [];
    for (let i = 0; i < 3; i++) {
      amounts.push(Number((await ret(sale, [{ saleLineId: sale.lines[0].id, qty: 1 }])).body.totalAmount));
    }
    expect(amounts).toEqual([66.67, 66.66, 66.67]);
    expect(amounts.reduce((acc, amount) => acc + amount, 0)).toBeCloseTo(200, 10);
    expect((await ret(sale, [{ saleLineId: sale.lines[0].id, qty: 1 }])).status).toBe(400);
  });

  it('accepts only the sold quantity when five returns arrive at once', async () => {
    const sale = await paidSale(2);
    const stock = await t.onHand(ctx.token, ctx.branch.id, itemId);
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => ret(sale, [{ saleLineId: sale.lines[0].id, qty: 1 }])));
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(await t.onHand(ctx.token, ctx.branch.id, itemId)).toBe(stock + 2);
  });

  it('refunds to a registered customer’s wallet', async () => {
    const before = (await t.ok('GET', `/customers/${customerId}/wallet`, ctx.token)).balance;
    const sale = await paidSale(1);
    expect((await ret(sale, [{ saleLineId: sale.lines[0].id, qty: 1 }], 'WALLET')).status).toBe(201);
    expect((await t.ok('GET', `/customers/${customerId}/wallet`, ctx.token)).balance).toBe(before + 100);
  });
});
