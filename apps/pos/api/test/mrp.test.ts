import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { line, startApp, type TestApp } from './helpers';

// Goods may never be sold above their MRP, which includes GST: not as an item's price, a sale
// unit's, a branch's own price, nor on a bill. An MRP of 0 means none is printed.
let t: TestApp;
let admin: string;
let ctx: Awaited<ReturnType<TestApp['branchWithRegister']>>;
beforeAll(async () => {
  t = await startApp();
  admin = await t.login();
  ctx = await t.branchWithRegister(admin);
});
afterAll(async () => { await t.close(); });

const newItem = (body: Record<string, unknown>) =>
  t.call('POST', '/items', ctx.token, { code: `M${randomUUID().slice(0, 10)}`, name: `MRP ${randomUUID().slice(0, 6)}`, uom: 'PCS', ...body });

describe('MRP', () => {
  it('checks an item price with GST added against the MRP', async () => {
    // 100 + 18% GST = 118.
    const over = await newItem({ sellPrice: 100, mrp: 110, taxRate: 18, taxMode: 'EXCLUSIVE' });
    expect(over.status).toBe(400);
    expect(over.body.message).toMatch(/118.00 with GST is above the MRP of 110.00/);
    expect((await newItem({ sellPrice: 100, mrp: 118, taxRate: 18, taxMode: 'EXCLUSIVE' })).status).toBe(201);
    expect((await newItem({ sellPrice: 120, mrp: 118, taxRate: 18, taxMode: 'INCLUSIVE' })).status).toBe(400);
    expect((await newItem({ sellPrice: 118, mrp: 118, taxRate: 18, taxMode: 'INCLUSIVE' })).status).toBe(201);
    // No MRP printed: nothing to check.
    const none = await newItem({ sellPrice: 500, taxRate: 18 });
    expect(none.status).toBe(201);
    expect(Number(none.body.mrp)).toBe(0);
    // Sale units too.
    const box = { uom: 'BOX', conversionQty: 10, sellPrice: 1000, mrp: 1100 };
    expect((await newItem({ sellPrice: 100, mrp: 118, taxRate: 18, saleUoms: [box] })).status).toBe(400);
    expect((await newItem({ sellPrice: 100, mrp: 118, taxRate: 18, saleUoms: [{ ...box, mrp: 1180 }] })).status).toBe(201);
  });

  it('keeps an item within its MRP when its price or tax changes', async () => {
    const item = (await newItem({ sellPrice: 100, mrp: 118, taxRate: 18 })).body;
    expect((await t.call('PATCH', `/items/${item.id}`, ctx.token, { taxRate: 28 })).status).toBe(400);
    expect((await t.call('PATCH', `/items/${item.id}`, ctx.token, { sellPrice: 101 })).status).toBe(400);
    expect((await t.call('PATCH', `/items/${item.id}`, ctx.token, { mrp: 100 })).status).toBe(400);
    expect((await t.call('PATCH', `/items/${item.id}`, ctx.token, { sellPrice: 90 })).status).toBe(200);
    expect((await t.call('PATCH', `/items/${item.id}`, ctx.token, { taxRate: 28, mrp: 120 })).status).toBe(200);
  });

  it('keeps branch prices within the MRP', async () => {
    const item = (await newItem({ sellPrice: 100, mrp: 118, taxRate: 18 })).body;
    const put = (prices: unknown[]) => t.call('PUT', `/items/${item.id}/branch-prices`, admin, { branchId: ctx.branch.id, prices });
    expect((await put([{ uom: 'PCS', sellPrice: 105 }])).status).toBe(400);
    expect((await put([{ uom: 'PCS', sellPrice: 105, mrp: 125 }])).status).toBe(200);
    // A tax change that would push the branch's price over its MRP is refused.
    expect((await t.call('PATCH', `/items/${item.id}`, ctx.token, { taxRate: 28, mrp: 130 })).status).toBe(400);
  });

  it('never bills above the MRP, even when the price was saved above it before', async () => {
    const item = (await newItem({ sellPrice: 100, mrp: 118, taxRate: 18 })).body;
    await t.ok('POST', '/stock/opening', ctx.token, { branchId: ctx.branch.id, itemId: item.id, qty: 10 });
    await t.db.item.update({ where: { id: item.id }, data: { mrp: 110 } });
    const sell = (rate: number) =>
      t.call('POST', '/sales', ctx.token, { branchId: ctx.branch.id, customerId: ctx.walkIn.id, lines: [line(item.id, { rate, taxRate: 18 })] });
    const refused = await sell(100);
    expect(refused.status).toBe(400);
    expect(refused.body.message).toMatch(/can't be above its MRP/);
    // At a price that is within it (93.22 + 18% = 110.00), it sells.
    expect((await sell(93.22)).status).toBe(201);
  });
});
