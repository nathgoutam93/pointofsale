import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withoutCosts } from '../src/common/cost-visibility.interceptor';
import { checkoutBody, line, startApp, type TestApp } from './helpers';

// What goods cost (cost prices, line costs, purchase history) is for admins and cashiers who
// adjust stock or record purchases; everyone else gets the same answers with the costs emptied.
let t: TestApp;
let admin: string;
let ctx: Awaited<ReturnType<TestApp['branchWithRegister']>>;
let itemId: string;
let purchaseId: string;
beforeAll(async () => {
  t = await startApp();
  admin = await t.login();
  ctx = await t.branchWithRegister(admin);
  itemId = (await t.item(ctx.token, ctx.branch.id, { costPrice: 42, stock: 0 })).id;
  purchaseId = (await t.ok('POST', '/purchases', admin, { branchId: ctx.branch.id, supplierName: 'Secret Supplier', lines: [{ itemId, qty: 10, unitCost: 42 }] })).id;
});
afterAll(async () => { await t.close(); });

const costsIn = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value.flatMap(costsIn);
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, inner]) => (key === 'costPrice' || key === 'unitCost' ? [inner] : costsIn(inner)));
};

describe('cost visibility', () => {
  it('empties every cost for a cashier who neither adjusts stock nor records purchases', async () => {
    const cashier = await t.cashierWithRegister(admin, ctx.branch.id);
    const sale = await t.ok('POST', '/sales/checkout', cashier.token, checkoutBody(ctx.branch.id, ctx.walkIn.id, [line(itemId)], [{ mode: 'CASH', amount: 100 }]));
    const answers = [
      await t.ok('GET', '/items', cashier.token),
      await t.ok('GET', `/stock/ledger?branchId=${ctx.branch.id}&itemId=${itemId}`, cashier.token),
      await t.ok('GET', `/sales/${sale.invoice.id}`, cashier.token),
      sale
    ];
    const costs = answers.flatMap(costsIn);
    expect(costs.length).toBeGreaterThan(3);
    expect(costs.every((cost) => cost === null)).toBe(true);

    // Purchases are history of what was paid: not for them.
    for (const path of [`/purchases?branchId=${ctx.branch.id}`, `/purchases/${purchaseId}`, `/purchase-returns?branchId=${ctx.branch.id}`]) {
      expect((await t.call('GET', path, cashier.token)).status, path).toBe(403);
    }
  });

  it('shows them to cashiers who adjust stock or record purchases, and to admins', async () => {
    for (const permissions of [['MANAGE_STOCK'], ['RECORD_PURCHASES']]) {
      const cashier = await t.cashierWithRegister(admin, ctx.branch.id, permissions);
      const item = (await t.ok<Array<{ id: string; costPrice: unknown }>>('GET', '/items', cashier.token)).find((row) => row.id === itemId);
      expect(Number(item?.costPrice)).toBe(42);
      expect((await t.call('GET', `/purchases/${purchaseId}`, cashier.token)).status).toBe(200);
    }
    expect(Number((await t.ok('GET', `/purchases/${purchaseId}`, admin)).lines[0].unitCost)).toBe(42);
  });

  it("doesn't let a cashier who can't see costs set one", async () => {
    const cashier = await t.cashierWithRegister(admin, ctx.branch.id, ['MANAGE_ITEMS']);
    await t.ok('PATCH', `/items/${itemId}`, cashier.token, { costPrice: 1, name: 'Renamed item' });
    const item = await t.db.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.name).toBe('Renamed item');
    expect(Number(item.costPrice)).toBe(42);
  });

  it('empties cost fields however deep, leaving the rest', () => {
    expect(withoutCosts({ a: 1, costPrice: 5, lines: [{ unitCost: 2, qty: 1, nested: { costPrice: '9' } }], at: null })).toEqual({
      a: 1,
      costPrice: null,
      lines: [{ unitCost: null, qty: 1, nested: { costPrice: null } }],
      at: null
    });
  });
});
