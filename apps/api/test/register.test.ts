import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkoutBody, line, startApp, type TestApp } from './helpers';

// #12: expected cash vs counted at close.
let t: TestApp;
let admin: string;
beforeAll(async () => { t = await startApp(); admin = await t.login(); });
afterAll(async () => { await t.close(); });

describe('register balance', () => {
  it('works out expected cash from cash taken and refunded on this register', async () => {
    const ctx = await t.branchWithRegister(admin, 500);
    const item = await t.item(ctx.token, ctx.branch.id, { taxRate: 18, stock: 1000 });
    const customer = await t.ok('POST', '/customers', ctx.token, { branchId: ctx.branch.id, name: 'Register customer' });
    await t.ok('POST', `/customers/${customer.id}/wallet/topup`, ctx.token, { amount: 500 });
    const la = (qty: number) => line(item.id, { qty, taxRate: 18 });
    const co = (customerId: string, qty: number, payments: unknown[]) =>
      t.ok('POST', '/sales/checkout', ctx.token, checkoutBody(ctx.branch.id, customerId, [la(qty)], payments));
    const s1 = await co(ctx.walkIn.id, 2, [{ mode: 'CASH', amount: 236 }]);
    await co(ctx.walkIn.id, 1, [{ mode: 'CARD', amount: 118 }]);
    await co(customer.id, 2, [{ mode: 'CASH', amount: 300 }]); // overpays; all 300 is in the drawer
    const s4 = await co(customer.id, 1, [{ mode: 'WALLET', amount: 118 }]);
    await t.ok('POST', `/sales/${s1.invoice.id}/return`, ctx.token, { lines: [{ saleLineId: s1.invoice.lines[0].id, qty: 1 }], refundMode: 'CASH' });
    await t.ok('POST', `/sales/${s4.invoice.id}/return`, ctx.token, { lines: [{ saleLineId: s4.invoice.lines[0].id, qty: 1 }], refundMode: 'WALLET' });

    expect(await t.ok('GET', '/registers/current', ctx.token)).toMatchObject({ cashSales: 536, cashRefunds: 118, expectedCash: 918 });
    const closed = await t.ok('POST', '/registers/close', ctx.token, { closingBalance: 900 });
    expect(closed.register).toMatchObject({ expectedCash: 918, closingBalance: 900, cashDifference: -18 });
    expect((await t.call('POST', '/sales/checkout', ctx.token, checkoutBody(ctx.branch.id, ctx.walkIn.id, [la(1)], [{ mode: 'CASH', amount: 118 }]))).status).toBe(401);
  });

  it('never records a payment on a register after it closes', async () => {
    const ctx = await t.branchWithRegister(admin, 100);
    const item = await t.item(ctx.token, ctx.branch.id, { stock: 1000 });
    const sales = Array.from({ length: 12 }, () =>
      t.call('POST', '/sales/checkout', ctx.token, checkoutBody(ctx.branch.id, ctx.walkIn.id, [line(item.id)], [{ mode: 'CASH', amount: 100 }]))
    );
    await new Promise((resolve) => setTimeout(resolve, 15));
    const closed = await t.call('POST', '/registers/close', ctx.token, { closingBalance: 100 });
    await Promise.all(sales);
    const register = await t.db.registerSession.findUniqueOrThrow({ where: { id: ctx.registerId } });
    expect(await t.db.payment.count({ where: { registerSessionId: ctx.registerId, createdAt: { gt: register.closedAt! } } })).toBe(0);
    const cash = await t.db.payment.aggregate({ where: { registerSessionId: ctx.registerId, mode: 'CASH' }, _sum: { amount: true } });
    expect(closed.body.register.expectedCash).toBe(100 + Number(cash._sum.amount ?? 0));
  });
});
