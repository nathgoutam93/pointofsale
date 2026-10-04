import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { line, startApp, type TestApp } from './helpers';

// A branch can sell an item at its own price; other branches keep the item's price.
let t: TestApp;
let admin: string;
let a: Awaited<ReturnType<TestApp['branchWithRegister']>>;
let b: Awaited<ReturnType<TestApp['branchWithRegister']>>;
beforeAll(async () => {
  t = await startApp();
  admin = await t.login();
  a = await t.branchWithRegister(admin);
  b = await t.branchWithRegister(admin);
});
afterAll(async () => { await t.close(); });

const box = { uom: 'BOX', conversionQty: 10, sellPrice: 900, mrp: 1000 };
const setPrices = (itemId: string, branchId: string, prices: unknown[]) =>
  t.call('PUT', `/items/${itemId}/branch-prices`, admin, { branchId, prices });
const listed = async (token: string, branchId: string, itemId: string) =>
  (await t.ok<Array<{ id: string; sellPrice: string; mrp: string; saleUoms: Array<{ uom: string; sellPrice: string }> }>>(
    'GET', `/items?branchId=${branchId}`, token
  )).find((item) => item.id === itemId)!;
const sell = (ctx: typeof a, lines: unknown[]) =>
  t.call('POST', '/sales', ctx.token, { branchId: ctx.branch.id, customerId: ctx.walkIn.id, lines });

describe('branch prices', () => {
  it('lists and charges the branch price at that branch only', async () => {
    const item = await t.item(a.token, a.branch.id, { sellPrice: 100, saleUoms: [box] });
    await t.ok('POST', '/stock/opening', b.token, { branchId: b.branch.id, itemId: item.id, qty: 100 });
    const set = await setPrices(item.id, a.branch.id, [{ uom: 'pcs', sellPrice: 120 }, { uom: 'box', sellPrice: 1100, mrp: 1200 }]);
    expect(set.status).toBe(200);
    // Units are stored as the item spells them; a left-out MRP is the item's (none here).
    expect(set.body.map((p: any) => [p.uom, Number(p.sellPrice), Number(p.mrp)])).toEqual([['BOX', 1100, 1200], ['PCS', 120, 0]]);

    const atA = await listed(a.token, a.branch.id, item.id);
    expect(Number(atA.sellPrice)).toBe(120);
    expect(atA.saleUoms.map((u) => [u.uom, Number(u.sellPrice)])).toEqual([['PCS', 120], ['BOX', 1100]]);
    expect(Number((await listed(b.token, b.branch.id, item.id)).sellPrice)).toBe(100);

    // The server prices against the branch's list price.
    expect((await sell(a, [line(item.id, { rate: 120 })])).status).toBe(201);
    expect((await sell(b, [line(item.id, { rate: 120 })])).body.message).toMatch(/above its list price of 100.00/);
    const boxLine = line(item.id, { saleUom: 'BOX', saleUomQty: 1, saleUomConversionQty: 10, qty: 10, rate: 1100 });
    expect((await sell(a, [boxLine])).status).toBe(201);

    expect(await t.ok('GET', `/items/${item.id}/branch-prices`, admin)).toHaveLength(2);
    // An empty list goes back to the item's prices.
    await t.ok('PUT', `/items/${item.id}/branch-prices`, admin, { branchId: a.branch.id, prices: [] });
    expect(Number((await listed(a.token, a.branch.id, item.id)).sellPrice)).toBe(100);
  });

  it('rejects units the item is not sold in', async () => {
    const item = await t.item(a.token, a.branch.id, { stock: 0 });
    expect((await setPrices(item.id, a.branch.id, [{ uom: 'CASE', sellPrice: 5 }])).body.message).toBe('This item is not sold in CASE');
    expect((await setPrices(item.id, a.branch.id, [{ uom: 'PCS', sellPrice: 5 }, { uom: 'pcs', sellPrice: 6 }])).status).toBe(400);
  });

  it('follows a renamed base unit and drops prices for removed sale units', async () => {
    const item = await t.item(a.token, a.branch.id, { stock: 0, saleUoms: [box] });
    await t.ok('PUT', `/items/${item.id}/branch-prices`, admin, {
      branchId: a.branch.id,
      prices: [{ uom: 'PCS', sellPrice: 90 }, { uom: 'BOX', sellPrice: 850 }]
    });
    await t.ok('PATCH', `/items/${item.id}`, admin, { uom: 'NOS', saleUoms: [] });
    const prices = await t.ok<Array<{ uom: string; sellPrice: string }>>('GET', `/items/${item.id}/branch-prices`, admin);
    expect(prices.map((p) => [p.uom, Number(p.sellPrice)])).toEqual([['NOS', 90]]);
  });

  it('is admin only to change', async () => {
    const item = await t.item(a.token, a.branch.id, { stock: 0 });
    const username = `till-${Date.now()}`;
    await t.ok('POST', '/users', admin, { branchId: a.branch.id, username, password: 'cashier-pass-1' });
    const cashier = await t.login(username, 'cashier-pass-1');
    expect((await t.call('PUT', `/items/${item.id}/branch-prices`, cashier, { branchId: a.branch.id, prices: [] })).status).toBe(400);
    expect((await t.call('GET', `/items/${item.id}/branch-prices`, cashier)).status).toBe(400);
  });
});
