import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkoutBody, line, startApp, type TestApp } from './helpers';

// #10: create and pay in one transaction; retries with the same key return the same sale.
let t: TestApp;
let ctx: Awaited<ReturnType<TestApp['branchWithRegister']>>;
let itemId: string;
let customerId: string;
beforeAll(async () => {
  t = await startApp();
  ctx = await t.branchWithRegister(await t.login());
  itemId = (await t.item(ctx.token, ctx.branch.id, { stock: 1000 })).id;
  customerId = (await t.ok('POST', '/customers', ctx.token, { branchId: ctx.branch.id, name: 'Checkout customer' })).id;
});
afterAll(async () => { await t.close(); });

const invoicesForItem = async () => t.db.saleInvoiceLine.count({ where: { itemId } });
const checkout = (body: unknown) => t.call('POST', '/sales/checkout', ctx.token, body);
const cash = (amount = 100) => [{ mode: 'CASH', amount }];

describe('checkout', () => {
  it('saves nothing when payment fails', async () => {
    const [stock, count] = [await t.onHand(ctx.token, ctx.branch.id, itemId), await invoicesForItem()];
    const res = await checkout(checkoutBody(ctx.branch.id, customerId, [line(itemId)], [{ mode: 'WALLET', amount: 100 }]));
    expect(res.status).toBe(400);
    expect(await invoicesForItem()).toBe(count);
    expect(await t.onHand(ctx.token, ctx.branch.id, itemId)).toBe(stock);
  });

  it('returns the same invoice and receipt when a checkout is retried', async () => {
    const body = checkoutBody(ctx.branch.id, ctx.walkIn.id, [line(itemId)], cash());
    const first = await checkout(body);
    const again = await checkout(body);
    expect(again.body.invoice.id).toBe(first.body.invoice.id);
    expect(again.body.receipt.id).toBe(first.body.receipt.id);
  });

  it('creates one invoice when five retries arrive at once', async () => {
    const [stock, count] = [await t.onHand(ctx.token, ctx.branch.id, itemId), await invoicesForItem()];
    const body = checkoutBody(ctx.branch.id, ctx.walkIn.id, [line(itemId)], cash());
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => checkout(body)));
    expect(new Set(results.map((r) => r.body.invoice?.id)).size).toBe(1);
    expect(await invoicesForItem()).toBe(count + 1);
    expect(await t.onHand(ctx.token, ctx.branch.id, itemId)).toBe(stock - 1);
  });

  it('allows credit sales for registered customers only; walk-ins pay in full', async () => {
    const credit = await checkout(checkoutBody(ctx.branch.id, customerId, [line(itemId)], []));
    expect(credit.body.invoice.status).toBe('DRAFT');
    expect(credit.body.receipt).toBeNull();
    expect((await checkout(checkoutBody(ctx.branch.id, ctx.walkIn.id, [line(itemId)], []))).status).toBe(400);
    expect((await checkout(checkoutBody(ctx.branch.id, ctx.walkIn.id, [line(itemId)], cash(40)))).status).toBe(400);
  });
});

describe('cash tendered', () => {
  it('records what was handed over; only the bill amount goes in the drawer', async () => {
    const register = await t.ok('GET', '/registers/current', ctx.token);
    const res = await checkout(checkoutBody(ctx.branch.id, ctx.walkIn.id, [line(itemId)], [{ mode: 'CASH', amount: 100, tendered: 500 }]));
    expect(res.status).toBe(200);
    expect(res.body.invoice.status).toBe('SETTLED');
    expect(res.body.invoice.payments[0]).toMatchObject({ mode: 'CASH', tendered: '500' });
    expect((await t.ok('GET', '/registers/current', ctx.token)).expectedCash).toBe(register.expectedCash + 100);

    // Not less than the payment, and only for cash.
    expect((await checkout(checkoutBody(ctx.branch.id, ctx.walkIn.id, [line(itemId)], [{ mode: 'CASH', amount: 100, tendered: 50 }]))).status).toBe(400);
    expect((await checkout(checkoutBody(ctx.branch.id, ctx.walkIn.id, [line(itemId)], [{ mode: 'CARD', amount: 100, tendered: 200 }]))).status).toBe(400);
    // Exact cash keeps no tendered amount.
    const exact = await checkout(checkoutBody(ctx.branch.id, ctx.walkIn.id, [line(itemId)], [{ mode: 'CASH', amount: 100, tendered: 100 }]));
    expect(exact.body.invoice.payments[0].tendered).toBeNull();
  });
});

describe('cancelling an unpaid draft', () => {
  it('cancels it and puts the stock back; nothing else can be cancelled', async () => {
    const draft = await t.ok('POST', '/sales', ctx.token, { branchId: ctx.branch.id, customerId, lines: [line(itemId, { qty: 2 })] });
    const stock = await t.onHand(ctx.token, ctx.branch.id, itemId);
    const res = await t.call('POST', `/sales/${draft.id}/cancel`, ctx.token, { reason: 'Test cancel' });
    expect(res.body.status).toBe('CANCELLED');
    expect(await t.onHand(ctx.token, ctx.branch.id, itemId)).toBe(stock + 2);
    expect(await t.db.stockLedger.count({ where: { referenceId: draft.id, txnType: 'SALE_CANCEL' } })).toBe(1);
    expect((await t.call('POST', `/sales/${draft.id}/cancel`, ctx.token, { reason: 'Test cancel' })).status).toBe(400);
    expect((await t.call('POST', `/sales/${draft.id}/settle`, ctx.token, { payments: cash(200) })).status).toBe(400);
    const paid = (await checkout(checkoutBody(ctx.branch.id, ctx.walkIn.id, [line(itemId)], cash()))).body.invoice;
    expect((await t.call('POST', `/sales/${paid.id}/cancel`, ctx.token, { reason: 'Test cancel' })).status).toBe(400);
  });

  it('records who cancelled it and why, and needs a reason', async () => {
    const draft = await t.ok('POST', '/sales', ctx.token, { branchId: ctx.branch.id, customerId, lines: [line(itemId)] });
    expect((await t.call('POST', `/sales/${draft.id}/cancel`, ctx.token, { reason: ' ' })).status).toBe(400);
    expect((await t.call('POST', `/sales/${draft.id}/cancel`, ctx.token)).status).toBe(400);
    const res = await t.ok('POST', `/sales/${draft.id}/cancel`, ctx.token, { reason: '  Customer changed their mind  ' });
    expect(res).toMatchObject({ status: 'CANCELLED', cancelReason: 'Customer changed their mind', cancelledByName: expect.any(String) });
    expect(res.cancelledAt).toBeTruthy();
  });

  it('only on the day it was made: an older credit sale is returned, not cancelled', async () => {
    const credit = (await checkout(checkoutBody(ctx.branch.id, customerId, [line(itemId)], []))).body.invoice;
    expect(credit.status).toBe('DRAFT');
    await t.db.saleInvoice.update({ where: { id: credit.id }, data: { createdAt: new Date(Date.now() - 2 * 86_400_000) } });
    const stock = await t.onHand(ctx.token, ctx.branch.id, itemId);
    const refused = await t.call('POST', `/sales/${credit.id}/cancel`, ctx.token, { reason: 'Too late' });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toMatch(/make a return instead/);
    expect((await t.ok('GET', `/sales/${credit.id}`, ctx.token)).status).toBe('DRAFT');
    expect(await t.onHand(ctx.token, ctx.branch.id, itemId)).toBe(stock);
  });

  it('does not accept a key another user already used', async () => {
    const key = randomUUID();
    await checkout(checkoutBody(ctx.branch.id, ctx.walkIn.id, [line(itemId)], cash(), { idempotencyKey: key }));
    const other = await t.branchWithRegister(await t.login());
    const res = await t.call('POST', '/sales/checkout', other.token, checkoutBody(other.branch.id, other.walkIn.id, [line(itemId)], cash(), { idempotencyKey: key }));
    expect(res.status).toBe(400);
  });
});
