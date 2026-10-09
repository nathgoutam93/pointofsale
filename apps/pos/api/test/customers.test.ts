import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addOpeningStock, checkoutBody, line, startApp, type TestApp } from './helpers';

// #13: customers shared across branches (or not, per setting). #14: walk-ins have no wallet.
let t: TestApp;
let admin: string;
beforeAll(async () => { t = await startApp(); admin = await t.login(); });
afterAll(async () => {
  await t.call('PATCH', '/business/settings', admin, { customerScope: 'SHARED' });
  await t.close();
});

describe('customer scope', () => {
  it('shares customers and wallets across branches, or keeps them per branch', async () => {
    await t.ok('PATCH', '/business/settings', admin, { customerScope: 'SHARED' });
    const x = await t.branchWithRegister(admin);
    const y = await t.branchWithRegister(admin);
    const item = await t.item(x.token, x.branch.id);
    await addOpeningStock(t.db, y.branch.id, item.id, 50);
    const phone = `9${Date.now().toString().slice(-9)}`;
    const asha = await t.ok('POST', '/customers', x.token, { branchId: x.branch.id, name: 'Asha', phone });
    await t.ok('POST', `/customers/${asha.id}/wallet/topup`, x.token, { amount: 300, mode: 'CASH' });
    const sellAtY = (payments: unknown[]) => t.call('POST', '/sales/checkout', y.token, checkoutBody(y.branch.id, asha.id, [line(item.id)], payments));

    // Shared
    expect((await t.ok('GET', `/customers?branchId=${y.branch.id}`, y.token)).some((c: { id: string }) => c.id === asha.id)).toBe(true);
    expect((await sellAtY([{ mode: 'WALLET', amount: 100 }])).status).toBe(200);
    expect((await t.ok('GET', `/customers/${asha.id}/wallet`, x.token)).balance).toBe(200);
    expect((await t.call('POST', '/customers', y.token, { branchId: y.branch.id, name: 'Duplicate', phone })).status).toBe(400);
    expect((await t.call('POST', '/sales/checkout', y.token, checkoutBody(y.branch.id, x.walkIn.id, [line(item.id)], [{ mode: 'CASH', amount: 100 }]))).status).toBe(400);

    // Per branch
    await t.ok('PATCH', '/business/settings', admin, { customerScope: 'BRANCH' });
    expect((await t.ok('GET', `/customers?branchId=${y.branch.id}`, y.token)).some((c: { id: string }) => c.id === asha.id)).toBe(false);
    expect((await t.call('GET', `/customers/${asha.id}/wallet`, y.token)).status).toBe(404);
    expect((await sellAtY([{ mode: 'CASH', amount: 100 }])).status).toBe(400);
    expect((await t.call('POST', '/customers', y.token, { branchId: y.branch.id, name: 'Asha (Y)', phone })).status).toBe(201);
    expect((await t.call('PATCH', '/business/settings', admin, { customerScope: 'GLOBAL' })).status).toBe(400);
  });
});

describe('walk-in customers', () => {
  it('have no wallet: no wallet refunds, payments, top-ups or balance', async () => {
    const ctx = await t.branchWithRegister(admin);
    const item = await t.item(ctx.token, ctx.branch.id);
    const sale = await t.ok('POST', '/sales/checkout', ctx.token, checkoutBody(ctx.branch.id, ctx.walkIn.id, [line(item.id)], [{ mode: 'CASH', amount: 100 }]));
    const ret = (refundMode: string) =>
      t.call('POST', `/sales/${sale.invoice.id}/return`, ctx.token, { lines: [{ saleLineId: sale.invoice.lines[0].id, qty: 1 }], refundMode, reason: 'Test return' });
    expect((await ret('WALLET')).status).toBe(400);
    // A balance left in the walk-in wallet from before stays frozen: it can't pay for a sale.
    await t.db.walletAccount.update({ where: { customerId: ctx.walkIn.id }, data: { balance: 500 } });
    expect((await t.call('POST', '/sales/checkout', ctx.token, checkoutBody(ctx.branch.id, ctx.walkIn.id, [line(item.id)], [{ mode: 'WALLET', amount: 100 }]))).status).toBe(400);
    expect(Number((await t.db.walletAccount.findUniqueOrThrow({ where: { customerId: ctx.walkIn.id } })).balance)).toBe(500);
    await t.db.walletAccount.update({ where: { customerId: ctx.walkIn.id }, data: { balance: 0 } });
    expect((await t.call('POST', `/customers/${ctx.walkIn.id}/wallet/topup`, ctx.token, { amount: 500, mode: 'CASH' })).status).toBe(400);
    expect((await t.call('GET', `/customers/${ctx.walkIn.id}/wallet`, ctx.token)).status).toBe(400);
    expect((await ret('CASH')).status).toBe(201);
    expect(Number((await t.db.walletAccount.findUniqueOrThrow({ where: { customerId: ctx.walkIn.id } })).balance)).toBe(0);
  });
});
