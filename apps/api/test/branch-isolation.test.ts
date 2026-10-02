import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkoutBody, line, startApp, type TestApp } from './helpers';

// #2: records from another branch are invisible (404), whatever id is sent.
let t: TestApp;
let admin: string;
beforeAll(async () => { t = await startApp(); admin = await t.login(); });
afterAll(async () => {
  await t.call('PATCH', '/business/settings', admin, { customerScope: 'SHARED' });
  await t.close();
});

describe('branch isolation', () => {
  it("hides one branch's sales, receipts and (per-branch) customer wallets from another", async () => {
    const a = await t.branchWithRegister(admin);
    const b = await t.branchWithRegister(admin);
    const item = await t.item(a.token, a.branch.id);
    const customer = await t.ok('POST', '/customers', a.token, { branchId: a.branch.id, name: 'Branch A customer' });
    const sale = await t.ok('POST', '/sales/checkout', a.token, checkoutBody(a.branch.id, customer.id, [line(item.id)], [{ mode: 'CASH', amount: 100 }]));
    const receipts = await t.ok('GET', `/receipts/by-invoice/${sale.invoice.id}`, a.token);

    for (const path of [`/sales/${sale.invoice.id}`, `/receipts/${receipts[0].id}`, `/receipts/by-invoice/${sale.invoice.id}`, `/receipts/by-invoice/${encodeURIComponent(sale.invoice.invoiceNo)}`]) {
      expect((await t.call('GET', path, a.token)).status, path).toBe(200);
      expect((await t.call('GET', path, b.token)).status, path).toBe(404);
    }

    await t.ok('PATCH', '/business/settings', admin, { customerScope: 'BRANCH' });
    expect((await t.call('GET', `/customers/${customer.id}/wallet`, b.token)).status).toBe(404);
    expect((await t.call('POST', `/customers/${customer.id}/wallet/topup`, b.token, { amount: 5000 })).status).toBe(404);
    const wallet = await t.ok('GET', `/customers/${customer.id}/wallet`, a.token);
    expect(wallet.balance).toBe(0);
  });
});
