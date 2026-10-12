import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from './helpers';

// Goods received from suppliers: stock in, numbered per branch, and the item's cost set to what was paid.
let t: TestApp;
let admin: string;
let ctx: Awaited<ReturnType<TestApp['branchWithRegister']>>;
beforeAll(async () => {
  t = await startApp();
  admin = await t.login();
  ctx = await t.branchWithRegister(admin);
});
afterAll(async () => { await t.close(); });

const purchase = (token: string, body: Record<string, unknown>) => t.call('POST', '/purchases', token, { branchId: ctx.branch.id, supplierName: 'Acme Traders', ...body });

describe('purchases', () => {
  it('adds stock, numbers the purchase and sets the item cost to what was paid', async () => {
    const item = await t.item(ctx.token, ctx.branch.id, { costPrice: 10, stock: 10 });
    const first = await purchase(ctx.token, {
      supplierInvoiceNo: 'INV-77',
      supplierInvoiceDate: '2026-10-01',
      lines: [{ itemId: item.id, qty: 30, unitCost: 14 }]
    });
    expect(first.status).toBe(201);
    expect(first.body.purchaseNo).toBe(`PUR-${ctx.branch.code}-000001`);
    expect(Number(first.body.totalCost)).toBe(420);
    expect(first.body.lines[0]).toMatchObject({ itemId: item.id, item: { code: item.code } });
    expect(await t.onHand(ctx.token, ctx.branch.id, item.id)).toBe(40);
    // The price paid, not an average with the 10 held at 10.
    expect(Number((await t.db.item.findUniqueOrThrow({ where: { id: item.id } })).costPrice)).toBe(14);

    const ledger = await t.ok<Array<{ txnType: string; qtyIn: string; referenceId: string }>>(
      'GET', `/stock/ledger?branchId=${ctx.branch.id}&itemId=${item.id}`, ctx.token
    );
    expect(ledger[0]).toMatchObject({ txnType: 'PURCHASE', referenceId: first.body.id });

    const second = await purchase(ctx.token, { lines: [{ itemId: item.id, qty: 1, unitCost: 12.5 }] });
    expect(second.body.purchaseNo).toBe(`PUR-${ctx.branch.code}-000002`);
    expect(Number((await t.db.item.findUniqueOrThrow({ where: { id: item.id } })).costPrice)).toBe(12.5);
    const list = await t.ok<Array<{ id: string }>>('GET', `/purchases?branchId=${ctx.branch.id}`, ctx.token);
    expect(list.map((row) => row.id)).toEqual([second.body.id, first.body.id]);
  });

  it('rejects bad lines, duplicate items and non-admins', async () => {
    const item = await t.item(ctx.token, ctx.branch.id, { stock: 0 });
    expect((await purchase(ctx.token, { lines: [] })).status).toBe(400);
    expect((await purchase(ctx.token, { lines: [{ itemId: item.id, qty: 0, unitCost: 1 }] })).status).toBe(400);
    expect((await purchase(ctx.token, { lines: [{ itemId: item.id, qty: 1, unitCost: -1 }] })).status).toBe(400);
    expect((await purchase(ctx.token, { lines: [{ itemId: item.id, qty: 1.5, unitCost: 1 }] })).body.message).toMatch(/multiples of 1/);
    expect(
      (await purchase(ctx.token, { lines: [{ itemId: item.id, qty: 1, unitCost: 1 }, { itemId: item.id, qty: 2, unitCost: 1 }] })).status
    ).toBe(400);
    expect((await purchase(ctx.token, { supplierGstin: 'NOT-A-GSTIN', lines: [{ itemId: item.id, qty: 1, unitCost: 1 }] })).status).toBe(400);

    const username = `buyer-${randomUUID().slice(0, 8)}`;
    await t.ok('POST', '/users', admin, { branchId: ctx.branch.id, username, password: 'cashier-pass-1' });
    const cashier = await t.login(username, 'cashier-pass-1');
    expect((await purchase(cashier, { lines: [{ itemId: item.id, qty: 1, unitCost: 1 }] })).status).toBe(400);
    expect(await t.onHand(ctx.token, ctx.branch.id, item.id)).toBe(0);
  });
});
