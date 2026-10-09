import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { line, startApp, type TestApp } from './helpers';

// GST is charged on the value after the discounts shown on the invoice (CGST Act s.15(3)):
// every saved line's tax is its rate × taxable value, whatever the discounts.
let t: TestApp;
let admin: string;
let ctx: Awaited<ReturnType<TestApp['branchWithRegister']>>;
let inclusive: string;
let exclusive: string;
beforeAll(async () => {
  t = await startApp();
  admin = await t.login();
  ctx = await t.branchWithRegister(admin);
  inclusive = (await t.item(ctx.token, ctx.branch.id, { sellPrice: 118, taxRate: 18, taxMode: 'INCLUSIVE' })).id;
  exclusive = (await t.item(ctx.token, ctx.branch.id, { sellPrice: 99.99, taxRate: 12, taxMode: 'EXCLUSIVE' })).id;
});
afterAll(async () => { await t.close(); });

describe('tax after discount', () => {
  it('charges each line its rate on the value after item and order discounts', async () => {
    const sale = await t.ok('POST', '/sales', ctx.token, {
      branchId: ctx.branch.id,
      customerId: ctx.walkIn.id,
      lines: [
        line(inclusive, { qty: 3, rate: 118, taxRate: 18, taxMode: 'INCLUSIVE', discounts: [{ type: 'FIXED', value: 10 }] }),
        line(exclusive, { qty: 7, rate: 99.99, taxRate: 12, taxMode: 'EXCLUSIVE', discounts: [{ type: 'PERCENTAGE', value: 7.5 }] })
      ],
      discounts: [{ type: 'PERCENTAGE', value: 5 }]
    });
    const saved = await t.ok('GET', `/sales/${sale.id}`, ctx.token);
    expect(saved.lines).toHaveLength(2);
    for (const row of saved.lines) {
      const taxable = Number(row.taxableAmount);
      expect(Math.abs(Number(row.taxAmount) - (taxable * Number(row.taxRate)) / 100)).toBeLessThanOrEqual(0.01);
    }
    // ₹354 incl. 18% is 300 before tax; ₹10 and then 5% off leave 275.50, taxed 49.59.
    expect(Number(saved.lines[0].taxableAmount)).toBe(275.5);
    expect(Number(saved.lines[0].taxAmount)).toBe(49.59);
  });

  it('has no setting to tax the price before discount', async () => {
    const settings = await t.ok('PATCH', '/business/settings', admin, { taxCalculationMode: 'BEFORE_DISCOUNT' });
    expect(settings).not.toHaveProperty('taxCalculationMode');
  });
});
