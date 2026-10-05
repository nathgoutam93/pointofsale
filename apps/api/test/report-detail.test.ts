import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkoutBody, line, startApp, type TestApp } from './helpers';

// The owner's report for any period: sales by item, category and cashier, discounts, and each
// register's day-end figures, for a branch or all of them.
let t: TestApp;
let admin: string;
beforeAll(async () => { t = await startApp(); admin = await t.login(); });
afterAll(async () => { await t.close(); });

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

describe('detailed report', () => {
  it('breaks a period down by item, category, cashier and register', async () => {
    const ctx = await t.branchWithRegister(admin, 200);
    const tea = await t.item(ctx.token, ctx.branch.id, { sellPrice: 100, costPrice: 60 });
    const soap = await t.item(ctx.token, ctx.branch.id, { sellPrice: 50, costPrice: 30 });
    await t.ok('PATCH', `/items/${tea.id}`, ctx.token, { category: 'Beverages' });
    await t.ok('PATCH', `/items/${soap.id}`, ctx.token, { category: 'Personal care' });
    const cashier = await t.cashierWithRegister(admin, ctx.branch.id, ['MAKE_RETURNS']);

    // The admin sells 3 tea with 10 off the order; the cashier sells 2 soap by UPI and takes one back.
    await t.ok('POST', '/sales/checkout', ctx.token, {
      ...checkoutBody(ctx.branch.id, ctx.walkIn.id, [line(tea.id, { qty: 3 })], [{ mode: 'CASH', amount: 290 }]),
      discounts: [{ type: 'FIXED', value: 10 }]
    });
    const soapSale = await t.ok('POST', '/sales/checkout', cashier.token, checkoutBody(ctx.branch.id, ctx.walkIn.id, [line(soap.id, { qty: 2, rate: 50 })], [{ mode: 'UPI', amount: 100 }]));
    await t.ok('POST', `/sales/${soapSale.invoice.id}/return`, cashier.token, { lines: [{ saleLineId: soapSale.invoice.lines[0].id, qty: 1 }], refundMode: 'CASH', reason: 'Damaged' });

    const report = await t.ok('GET', `/reports/detail?branchId=${ctx.branch.id}&from=${today()}&to=${today()}`, admin);
    expect(report.summary).toMatchObject({ invoiceCount: 2, grossSales: 390, returnsGross: 50, collections: { cash: 290, upi: 100 } });
    expect(report.items).toEqual([
      expect.objectContaining({ itemId: tea.id, category: 'Beverages', qty: 3, sales: 290, cost: 180, profit: 110 }),
      expect.objectContaining({ itemId: soap.id, category: 'Personal care', qty: 1, sales: 50, cost: 30, profit: 20 })
    ]);
    expect(report.categories.map((row: { category: string; sales: number }) => [row.category, row.sales])).toEqual([
      ['Beverages', 290],
      ['Personal care', 50]
    ]);
    expect(report.cashiers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: cashier.username, invoices: 1, sales: 100, returns: 50 }),
        expect.objectContaining({ invoices: 1, sales: 290, returns: 0 })
      ])
    );
    expect(report.discounts).toEqual({ item: 0, order: 10 });
    const registers = Object.fromEntries(report.registers.map((row: { id: string }) => [row.id, row]));
    expect(registers[ctx.registerId]).toMatchObject({ openingBalance: 200, cashSales: 290, cashRefunds: 0, expectedCash: 490 });
    expect(registers[cashier.registerId]).toMatchObject({ cashSales: 0, upiSales: 100, cashRefunds: 50, expectedCash: -50 });

    // Every branch the admin manages, together.
    const other = await t.branchWithRegister(admin);
    const otherItem = await t.item(other.token, other.branch.id);
    await t.ok('POST', '/sales/checkout', other.token, checkoutBody(other.branch.id, other.walkIn.id, [line(otherItem.id)], [{ mode: 'CASH', amount: 100 }]));
    const all = await t.ok('GET', `/reports/detail?from=${today()}&to=${today()}`, admin);
    expect(all.branchIds).toEqual(expect.arrayContaining([ctx.branch.id, other.branch.id]));
    expect(all.summary.grossSales).toBeGreaterThanOrEqual(490);
  });

  it('checks the period and who asks', async () => {
    const ctx = await t.branchWithRegister(admin);
    expect((await t.call('GET', `/reports/detail?from=2026-02-10&to=2026-02-01`, admin)).status).toBe(400);
    expect((await t.call('GET', `/reports/detail?from=2024-01-01&to=2026-01-01`, admin)).status).toBe(400);
    expect((await t.call('GET', `/reports/detail?from=2026-1-1&to=2026-01-02`, admin)).status).toBe(400);
    const cashier = await t.cashierWithRegister(admin, ctx.branch.id);
    expect((await t.call('GET', `/reports/detail?from=${today()}&to=${today()}`, cashier.token)).status).toBe(403);
  });
});
