import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
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
const settle = (id: string, payments: unknown[], idempotencyKey = randomUUID()) => t.call('POST', `/sales/${id}/settle`, ctx.token, { payments, idempotencyKey });

describe('settling a sale', () => {
  it('requires a durable payment ID before recording any money', async () => {
    const sale = await draft();
    const rejected = await t.call('POST', `/sales/${sale.id}/settle`, ctx.token, { payments: [{ mode: 'CASH', amount: 60 }] });
    expect(rejected.status).toBe(400);
    expect(await t.db.payment.count({ where: { invoiceId: sale.id } })).toBe(0);
  });
  it('adds up every wallet line and never lets the wallet pay more than is due', async () => {
    await t.ok('POST', `/customers/${customerId}/wallet/topup`, ctx.token, { amount: 5, mode: 'CASH' });
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
    await t.ok('POST', `/customers/${customerId}/wallet/topup`, ctx.token, { amount: 150, mode: 'CASH' });
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

  it('replays a concurrent partial payment without taking more money or issuing another receipt', async () => {
    const sale = await draft();
    const key = randomUUID();
    const payments = [{ mode: 'CASH', amount: 60 }];
    const results = await Promise.all(Array.from({ length: 5 }, () => settle(sale.id, payments, key)));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(new Set(results.map((r) => r.body.receipt.id)).size).toBe(1);
    expect(results[0].body.invoice.paidTotal).toBe('60');
    expect(await t.db.payment.count({ where: { invoiceId: sale.id } })).toBe(1);
    expect(await t.db.receipt.count({ where: { invoiceId: sale.id } })).toBe(1);
    // A later, intentional part payment has its own ID.
    const next = await settle(sale.id, [{ mode: 'CASH', amount: 140 }], randomUUID());
    expect(next.body.invoice.status).toBe('SETTLED');
    const retryAfterPaid = await settle(sale.id, payments, key);
    expect(retryAfterPaid.status).toBe(200);
    expect(retryAfterPaid.body.receipt.id).toBe(results[0].body.receipt.id);
    expect(retryAfterPaid.body.invoice.paidTotal).toBe('200');
  });

  it('rejects a payment ID reused with different details, an invoice, or another cashier', async () => {
    const [sale, other] = [await draft(), await draft()];
    const key = randomUUID();
    const payments = [{ mode: 'CASH', amount: 60 }];
    expect((await settle(sale.id, payments, key)).status).toBe(200);
    for (const changed of [[{ mode: 'CASH', amount: 61 }], [{ mode: 'CARD', amount: 60 }], [{ mode: 'CASH', amount: 60, tendered: 100 }]]) {
      expect((await settle(sale.id, changed, key)).status).toBe(400);
    }
    expect((await settle(other.id, payments, key)).status).toBe(400);
    const cashier = await t.cashierWithRegister(await t.login(), ctx.branch.id);
    const forbidden = await t.call('POST', `/sales/${sale.id}/settle`, cashier.token, { payments, idempotencyKey: key });
    expect(forbidden.status).toBe(400);
    expect(await t.db.payment.count({ where: { invoiceId: sale.id } })).toBe(1);
    expect(await t.db.payment.count({ where: { invoiceId: other.id } })).toBe(0);
  });

  it('does not debit the wallet or credit overpayment twice on retry', async () => {
    await t.db.walletAccount.update({ where: { customerId }, data: { balance: 100 } });
    const sale = await draft();
    const key = randomUUID();
    const payments = [{ mode: 'WALLET', amount: 60 }, { mode: 'CARD', amount: 200 }];
    const first = await settle(sale.id, payments, key);
    expect(first.status).toBe(200);
    expect(await balance()).toBe(100); // 60 spent; 60 in overpayment credited.
    const again = await settle(sale.id, payments, key);
    expect(again.status).toBe(200);
    expect(again.body.receipt.id).toBe(first.body.receipt.id);
    expect(await balance()).toBe(100);
    expect(await t.db.walletTxn.count({ where: { referenceType: 'SALE', referenceId: sale.id } })).toBe(2);
  });

  it('allows retrying a rejected operation after the payment can succeed', async () => {
    const sale = await draft();
    const key = randomUUID();
    await t.db.walletAccount.update({ where: { customerId }, data: { balance: 0 } });
    const payments = [{ mode: 'WALLET', amount: 60 }];
    expect((await settle(sale.id, payments, key)).status).toBe(400);
    expect(await t.db.receipt.findUnique({ where: { idempotencyKey: key } })).toBeNull();
    await t.db.walletAccount.update({ where: { customerId }, data: { balance: 100 } });
    expect((await settle(sale.id, payments, key)).status).toBe(200);
    expect(await balance()).toBe(40);
  });
});
