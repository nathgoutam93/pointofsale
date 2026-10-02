import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { line, startApp, type TestApp } from './helpers';

// #9: stock can't go negative, and only one register per branch can be open.
let t: TestApp;
let admin: string;
let ctx: Awaited<ReturnType<TestApp['branchWithRegister']>>;
beforeAll(async () => {
  t = await startApp();
  admin = await t.login();
  ctx = await t.branchWithRegister(admin);
});
afterAll(async () => { await t.close(); });

const sale = (lines: unknown[]) => t.call('POST', '/sales', ctx.token, { branchId: ctx.branch.id, customerId: ctx.walkIn.id, lines });

describe('stock', () => {
  it('sells the last unit only once when five registers try at the same moment', async () => {
    const item = await t.item(ctx.token, ctx.branch.id, { stock: 1 });
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => sale([line(item.id)])));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await t.onHand(ctx.token, ctx.branch.id, item.id)).toBe(0);
  });

  it('adds up every line of an item, including boxes and loose pieces', async () => {
    const item = await t.item(ctx.token, ctx.branch.id, { stock: 10, saleUoms: [{ uom: 'BOX', conversionQty: 10, sellPrice: 1000 }] });
    const box = line(item.id, { saleUom: 'BOX', saleUomQty: 1, saleUomConversionQty: 10, qty: 10, rate: 1000 });
    const res = await sale([box, line(item.id)]);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/10 on hand, 11 needed/);
    expect((await sale([box])).status).toBe(201);
  });

  it('never lets concurrent stock-outs go below zero', async () => {
    const item = await t.item(ctx.token, ctx.branch.id, { stock: 3 });
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map(() => t.call('POST', '/stock/adjustment', ctx.token, { branchId: ctx.branch.id, itemId: item.id, qty: 1, direction: 'OUT', reason: 'damaged' }))
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(await t.onHand(ctx.token, ctx.branch.id, item.id)).toBe(0);
  });

  it('opens only one register per branch when five try at once', async () => {
    const code = `R${Date.now().toString().slice(-7)}`;
    const branch = await t.ok('POST', '/branches', admin, { name: `Registers ${code}`, code });
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => t.call('POST', '/registers/open', admin, { branchId: branch.id, openingBalance: 0 })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await t.db.registerSession.count({ where: { branchId: branch.id, closedAt: null } })).toBe(1);
  });
});
