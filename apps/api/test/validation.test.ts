import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { line, startApp, type TestApp } from './helpers';

// #3: request bodies, query strings and ids are checked before reaching the service.
let t: TestApp;
let ctx: Awaited<ReturnType<TestApp['branchWithRegister']>>;
let itemId: string;
let customerId: string;
beforeAll(async () => {
  t = await startApp();
  ctx = await t.branchWithRegister(await t.login());
  itemId = (await t.item(ctx.token, ctx.branch.id)).id;
  customerId = (await t.ok('POST', '/customers', ctx.token, { branchId: ctx.branch.id, name: 'Validation customer' })).id;
});
afterAll(async () => { await t.close(); });

const sale = (lines: unknown[], discounts: unknown[] = []) => ({ branchId: ctx.branch.id, customerId, lines, discounts });

describe('request validation', () => {
  it.each([
    ['negative wallet top-up', 'POST', () => `/customers/${customerId}/wallet/topup`, () => ({ amount: -5000 })],
    ['zero wallet top-up', 'POST', () => `/customers/${customerId}/wallet/topup`, () => ({ amount: 0 })],
    ['missing amount', 'POST', () => `/customers/${customerId}/wallet/topup`, () => ({})],
    ['qty 0', 'POST', () => '/sales', () => sale([line(itemId, { qty: 0 })])],
    ['negative rate', 'POST', () => '/sales', () => sale([line(itemId, { rate: -1 })])],
    ['tax rate 150', 'POST', () => '/sales', () => sale([line(itemId, { taxRate: 150 })])],
    ['no lines', 'POST', () => '/sales', () => sale([])],
    ['120% discount', 'POST', () => '/sales', () => sale([line(itemId)], [{ type: 'PERCENTAGE', value: 120 }])],
    ['blank adjustment reason', 'POST', () => '/stock/adjustment', () => ({ branchId: ctx.branch.id, itemId, qty: 1, direction: 'OUT', reason: '  ' })],
    ['negative closing balance', 'POST', () => '/registers/close', () => ({ closingBalance: -1 })],
    ['blank customer name', 'POST', () => '/customers', () => ({ branchId: ctx.branch.id, name: '  ' })]
  ])('rejects %s with 400', async (_name, method, path, body) => {
    const res = await t.call(method, path(), ctx.token, body());
    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.message)).toBe(true);
  });

  it('rejects JSON numbers that are not finite', async () => {
    const res = await fetch(`${t.baseUrl}/customers/${customerId}/wallet/topup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ctx.token}` },
      body: '{"amount":1e999}'
    });
    expect(res.status).toBe(400);
  });

  it('checks query strings and ids', async () => {
    expect((await t.call('GET', '/reports/sales-summary', ctx.token)).status).toBe(400);
    expect((await t.call('GET', '/users', ctx.token)).status).toBe(400);
    expect((await t.call('GET', '/sales/not-a-uuid', ctx.token)).status).toBe(400);
    expect((await t.call('GET', `/items?activeOnly=maybe`, ctx.token)).status).toBe(400);
  });

  it('treats activeOnly=false as false', async () => {
    const extra = await t.item(ctx.token, ctx.branch.id, { stock: 0 });
    await t.ok('PATCH', `/items/${extra.id}`, ctx.token, { isActive: false });
    const all = await t.ok('GET', '/items?activeOnly=false', ctx.token);
    const active = await t.ok('GET', '/items?activeOnly=true', ctx.token);
    expect(all.some((i: { id: string }) => i.id === extra.id)).toBe(true);
    expect(active.some((i: { id: string }) => i.id === extra.id)).toBe(false);
  });
});
