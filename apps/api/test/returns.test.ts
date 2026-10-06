import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkoutBody, line, startApp, type TestApp } from './helpers';

// #8: returns never refund more than was charged; on a bill not yet paid in full they first
// lower what is owed.
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
/** The money fields of an invoice or return, as numbers (the API sends decimals as strings). */
const money = (row: Record<string, unknown>) =>
  Object.fromEntries(
    ['totalAmount', 'dueAdjusted', 'refundAmount', 'paidTotal', 'creditedTotal', 'grandTotal'].filter((key) => key in row).map((key) => [key, Number(row[key])])
  );
const ret = (invoice: { id: string }, lines: unknown[], refundMode = 'CASH') =>
  t.call('POST', `/sales/${invoice.id}/return`, ctx.token, { lines, refundMode, reason: 'Test return' });

describe('returns', () => {
  it('refuses a cancelled invoice, leaving stock alone', async () => {
    const cancelled = await paidSale(1);
    await t.db.saleInvoice.update({ where: { id: cancelled.id }, data: { status: 'CANCELLED' } });
    const stock = await t.onHand(ctx.token, ctx.branch.id, itemId);
    expect((await ret(cancelled, [{ saleLineId: cancelled.lines[0].id, qty: 1 }])).status).toBe(400);
    expect(await t.onHand(ctx.token, ctx.branch.id, itemId)).toBe(stock);
  });

  it('takes a return on a credit sale off what is owed, refunding nothing', async () => {
    const register = await t.ok('GET', '/registers/current', ctx.token);
    const stock = await t.onHand(ctx.token, ctx.branch.id, itemId);
    const credit = (await t.ok('POST', '/sales/checkout', ctx.token, checkoutBody(ctx.branch.id, customerId, [line(itemId, { qty: 3 })], []))).invoice;
    expect(credit.status).toBe('DRAFT');

    const first = await ret(credit, [{ saleLineId: credit.lines[0].id, qty: 1 }]);
    expect(first.status).toBe(201);
    expect(money(first.body)).toMatchObject({ totalAmount: 100, dueAdjusted: 100, refundAmount: 0 });
    let invoice = await t.ok('GET', `/sales/${credit.id}`, ctx.token);
    expect({ ...money(invoice), status: invoice.status }).toMatchObject({ paidTotal: 0, creditedTotal: 100, status: 'PARTIALLY_SETTLED' });
    // With a credit note against it, the bill can't be cancelled any more.
    expect((await t.call('POST', `/sales/${credit.id}/cancel`, ctx.token, { reason: 'Test cancel' })).status).toBe(400);
    // Paying what is left settles it; nothing more can be paid.
    expect((await t.call('POST', `/sales/${credit.id}/settle`, ctx.token, { idempotencyKey: randomUUID(), payments: [{ mode: 'WALLET', amount: 250 }] })).status).toBe(400);

    const rest = await ret(credit, [{ saleLineId: credit.lines[0].id, qty: 2 }]);
    expect(money(rest.body)).toMatchObject({ dueAdjusted: 200, refundAmount: 0 });
    invoice = await t.ok('GET', `/sales/${credit.id}`, ctx.token);
    expect({ ...money(invoice), status: invoice.status }).toMatchObject({ creditedTotal: 300, status: 'SETTLED' });
    expect(await t.onHand(ctx.token, ctx.branch.id, itemId)).toBe(stock);
    // No money moved: the drawer expects what it did before.
    expect((await t.ok('GET', '/registers/current', ctx.token)).expectedCash).toBe(register.expectedCash);
    const listed = (await t.ok('GET', '/returns', ctx.token)).find((row: { id: string }) => row.id === rest.body.id);
    expect(money(listed)).toMatchObject({ dueAdjusted: 200, refundAmount: 0 });
  });

  it('on a part-paid bill, lowers the due first and refunds only the rest', async () => {
    const register = await t.ok('GET', '/registers/current', ctx.token);
    const sale = (await t.ok('POST', '/sales/checkout', ctx.token, checkoutBody(ctx.branch.id, customerId, [line(itemId, { qty: 3 })], [{ mode: 'CASH', amount: 150 }]))).invoice;
    expect(sale.status).toBe('PARTIALLY_SETTLED');

    // 300 billed, 150 paid, 150 owed: returning 200 clears the 150 and refunds 50 in cash.
    const returned = await ret(sale, [{ saleLineId: sale.lines[0].id, qty: 2 }]);
    expect(money(returned.body)).toMatchObject({ totalAmount: 200, dueAdjusted: 150, refundAmount: 50 });
    const paidDown = await t.ok('GET', `/sales/${sale.id}`, ctx.token);
    expect({ ...money(paidDown), status: paidDown.status }).toMatchObject({ paidTotal: 150, creditedTotal: 150, status: 'SETTLED' });
    expect((await t.ok('GET', '/registers/current', ctx.token)).expectedCash).toBe(register.expectedCash + 150 - 50);
    // The last unit: all refunded (150 paid, 50 refunded so far).
    expect(money((await ret(sale, [{ saleLineId: sale.lines[0].id, qty: 1 }])).body)).toMatchObject({ dueAdjusted: 0, refundAmount: 100 });
  });

  it('a part-paid bill with a return keeps the rest due until paid', async () => {
    const sale = (await t.ok('POST', '/sales/checkout', ctx.token, checkoutBody(ctx.branch.id, customerId, [line(itemId, { qty: 4 })], [{ mode: 'CASH', amount: 100 }]))).invoice;
    // 400 billed, 100 paid: returning one (100) leaves 200 owed.
    expect(money((await ret(sale, [{ saleLineId: sale.lines[0].id, qty: 1 }])).body)).toMatchObject({ dueAdjusted: 100, refundAmount: 0 });
    expect((await t.call('POST', `/sales/${sale.id}/settle`, ctx.token, { idempotencyKey: randomUUID(), payments: [{ mode: 'WALLET', amount: 250 }] })).status).toBe(400);
    const settled = await t.ok('POST', `/sales/${sale.id}/settle`, ctx.token, { idempotencyKey: randomUUID(), payments: [{ mode: 'CASH', amount: 200 }] });
    const after = settled.invoice ?? settled;
    expect({ ...money(after), status: after.status }).toMatchObject({ paidTotal: 300, creditedTotal: 100, status: 'SETTLED' });
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
