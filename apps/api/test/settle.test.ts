import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { line, startApp, type TestApp } from './helpers';

// #7: settling a sale and paying from a wallet.
let t: TestApp;
let ctx: Awaited<ReturnType<TestApp['branchWithRegister']>>;
let itemId: string;
let customerId: string;
beforeAll(async () => {
  t = await startApp();
  ctx = await t.branchWithRegister(await t.login());
  itemId = (await t.item(ctx.token, ctx.branch.id, { sellPrice: 200, stock: 1000 })).id;
  customerId = (await t.ok('POST', '/customers', ctx.token, { branchId: ctx.branch.id, name: 'Wallet customer' })).id;
});
afterAll(async () => { await t.close(); });

const balance = async () => (await t.ok('GET', `/customers/${customerId}/wallet`, ctx.token)).balance as number;
const draft = (customer = customerId) =>
  t.ok('POST', '/sales', ctx.token, { branchId: ctx.branch.id, customerId: customer, lines: [line(itemId, { rate: 200 })] });
const settle = (id: string, payments: unknown[]) => t.call('POST', `/sales/${id}/settle`, ctx.token, { payments });

describe('settling a sale', () => {
  it('adds up every wallet line and never lets the wallet pay more than is due', async () => {
    await t.ok('POST', `/customers/${customerId}/wallet/topup`, ctx.token, { amount: 5 });
    const sale = await draft();
    expect((await settle(sale.id, [{ mode: 'WALLET', amount: 1 }, { mode: 'WALLET', amount: 1000 }])).status).toBe(400);
    expect((await settle(sale.id, [{ mode: 'WALLET', amount: 3 }, { mode: 'WALLET', amount: 3 }, { mode: 'CASH', amount: 194 }])).status).toBe(400);
    expect(await balance()).toBe(5);
    const paid = await settle(sale.id, [{ mode: 'WALLET', amount: 2 }, { mode: 'WALLET', amount: 3 }, { mode: 'CASH', amount: 195 }]);
    expect(paid.body.invoice.status).toBe('SETTLED');
    expect(await balance()).toBe(0);
  });

  it('refuses to take payment for an invoice that is already paid', async () => {
    const sale = await draft();
    await settle(sale.id, [{ mode: 'CASH', amount: 200 }]);
    expect((await settle(sale.id, [{ mode: 'CASH', amount: 500 }])).status).toBe(400);
    expect(await balance()).toBe(0);
  });

  it('allows part payment, then the rest', async () => {
    await t.ok('POST', `/customers/${customerId}/wallet/topup`, ctx.token, { amount: 150 });
    const sale = await draft();
    expect((await settle(sale.id, [{ mode: 'CASH', amount: 50 }])).body.invoice.status).toBe('PARTIALLY_SETTLED');
    expect((await settle(sale.id, [{ mode: 'WALLET', amount: 150 }])).body.invoice.status).toBe('SETTLED');
  });

  it('credits a registered customer’s card overpayment to their wallet, and refuses a walk-in overpayment', async () => {
    const before = await balance();
    const sale = await draft();
    const res = await settle(sale.id, [{ mode: 'CARD', amount: 250 }]);
    expect(Number(res.body.invoice.paidTotal)).toBe(200);
    expect(await balance()).toBe(before + 50);
    const walkIn = await draft(ctx.walkIn.id);
    expect((await settle(walkIn.id, [{ mode: 'CASH', amount: 250 }])).status).toBe(400);
  });

  it('records one payment when the same invoice is settled five times at once', async () => {
    const sale = await draft();
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => settle(sale.id, [{ mode: 'CASH', amount: 200 }])));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await t.db.payment.count({ where: { invoiceId: sale.id } })).toBe(1);
  });

  it('lets only one of two sales spend the same wallet balance', async () => {
    await t.db.walletAccount.update({ where: { customerId }, data: { balance: 200 } });
    const [a, b] = [await draft(), await draft()];
    const results = await Promise.all([settle(a.id, [{ mode: 'WALLET', amount: 200 }]), settle(b.id, [{ mode: 'WALLET', amount: 200 }])]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(await balance()).toBe(0);
  });
});
