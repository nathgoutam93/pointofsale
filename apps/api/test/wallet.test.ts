import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from './helpers';

// Wallet money has a trail: top-ups are taken on an open register with a payment mode and
// count in its takings; admins correct balances with a reason; every entry names its author.
let t: TestApp;
let admin: string;
beforeAll(async () => { t = await startApp(); admin = await t.login(); });
afterAll(async () => { await t.close(); });

describe('wallet top-ups', () => {
  it('are taken on the open register, recorded with who took them and how, and counted in its takings', async () => {
    const ctx = await t.branchWithRegister(admin, 100);
    const customer = await t.ok('POST', '/customers', ctx.token, { branchId: ctx.branch.id, name: 'Top-up customer' });
    const topup = (token: string, body: unknown, query = '') => t.call('POST', `/customers/${customer.id}/wallet/topup${query}`, token, body);

    const cash = await topup(ctx.token, { amount: 200, mode: 'CASH' });
    expect(cash.status).toBe(200);
    expect(cash.body).toMatchObject({ type: 'TOPUP', paymentMode: 'CASH', registerSessionId: ctx.registerId, createdByName: expect.any(String) });
    expect((await topup(ctx.token, { amount: 50, mode: 'UPI', reference: 'UTR123' })).status).toBe(200);
    expect((await topup(ctx.token, { amount: 30, mode: 'CARD' })).status).toBe(200);
    expect((await t.ok('GET', `/customers/${customer.id}/wallet`, ctx.token)).balance).toBe(280);
    expect(await t.ok('GET', '/registers/current', ctx.token)).toMatchObject({
      cashSales: 0,
      cashTopups: 200,
      expectedCash: 300,
      cardSales: 30,
      upiSales: 50
    });

    // No register open (an admin managing the branch): no top-up.
    const noRegister = await topup(admin, { amount: 10, mode: 'CASH' }, `?branchId=${ctx.branch.id}`);
    expect(noRegister.status).toBe(400);
    // Another branch than the register's.
    const other = await t.newBranch(admin);
    expect((await topup(ctx.token, { amount: 10, mode: 'CASH' }, `?branchId=${other.id}`)).status).toBe(400);
    expect((await t.ok('GET', `/customers/${customer.id}/wallet`, ctx.token)).balance).toBe(280);
  });

  it('need the permission for cashiers', async () => {
    const ctx = await t.branchWithRegister(admin);
    const customer = await t.ok('POST', '/customers', ctx.token, { branchId: ctx.branch.id, name: 'Cashier top-up customer' });
    const allowed = await t.cashierWithRegister(admin, ctx.branch.id, ['TOP_UP_WALLETS']);
    const res = await t.call('POST', `/customers/${customer.id}/wallet/topup`, allowed.token, { amount: 75, mode: 'CASH' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ createdByName: allowed.username, registerSessionId: allowed.registerId });
  });

  it('record who made the wallet entries of sales and returns', async () => {
    const ctx = await t.branchWithRegister(admin);
    const item = await t.item(ctx.token, ctx.branch.id);
    const customer = await t.ok('POST', '/customers', ctx.token, { branchId: ctx.branch.id, name: 'Wallet sale customer' });
    await t.ok('POST', `/customers/${customer.id}/wallet/topup`, ctx.token, { amount: 100, mode: 'CASH' });
    const sale = await t.ok('POST', '/sales/checkout', ctx.token, {
      branchId: ctx.branch.id,
      customerId: customer.id,
      idempotencyKey: crypto.randomUUID(),
      lines: [{ itemId: item.id, qty: 1, rate: 100, taxRate: 0 }],
      payments: [{ mode: 'WALLET', amount: 100 }]
    });
    await t.ok('POST', `/sales/${sale.invoice.id}/return`, ctx.token, { lines: [{ saleLineId: sale.invoice.lines[0].id, qty: 1 }], refundMode: 'WALLET', reason: 'Test return' });
    const wallet = await t.db.walletAccount.findUniqueOrThrow({ where: { customerId: customer.id }, include: { txns: true } });
    expect(wallet.txns).toHaveLength(3);
    expect(wallet.txns.every((txn) => txn.createdBy && txn.createdByName)).toBe(true);
    // Only the counter top-up carries a payment mode and register.
    expect(wallet.txns.filter((txn) => txn.paymentMode !== null).map((txn) => txn.type)).toEqual(['TOPUP']);
  });
});

describe('wallet adjustments', () => {
  it('are for admins, need a reason, and never take the balance below 0', async () => {
    const ctx = await t.branchWithRegister(admin);
    const customer = await t.ok('POST', '/customers', ctx.token, { branchId: ctx.branch.id, name: 'Adjusted customer' });
    const adjust = (token: string, body: unknown) => t.call('POST', `/customers/${customer.id}/wallet/adjust?branchId=${ctx.branch.id}`, token, body);

    // No register needed: no money changes hands.
    const up = await adjust(admin, { amount: 40, reason: 'Goodwill for a late delivery' });
    expect(up.status).toBe(200);
    expect(up.body).toMatchObject({ type: 'ADJUSTMENT', amount: 40, reason: 'Goodwill for a late delivery', paymentMode: null, registerSessionId: null });
    expect((await adjust(admin, { amount: -15, reason: 'Entered twice' })).status).toBe(200);
    expect((await t.ok('GET', `/customers/${customer.id}/wallet`, ctx.token)).balance).toBe(25);

    expect((await adjust(admin, { amount: -26, reason: 'Too much' })).status).toBe(400);
    expect((await adjust(admin, { amount: 10, reason: ' ' })).status).toBe(400);
    expect((await adjust(admin, { amount: 0, reason: 'Nothing' })).status).toBe(400);
    const cashier = await t.cashierWithRegister(admin, ctx.branch.id, ['TOP_UP_WALLETS']);
    expect((await adjust(cashier.token, { amount: 10, reason: 'Cashier tries' })).status).toBe(403);
    expect((await t.ok('GET', `/customers/${customer.id}/wallet`, ctx.token)).balance).toBe(25);
    // Nothing in the drawer.
    expect(await t.ok('GET', '/registers/current', ctx.token)).toMatchObject({ cashTopups: 0, expectedCash: 0 });
  });
});
