import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkoutBody, line, startApp, type TestApp } from './helpers';

// A bill's total rounded to the rupee (a business setting): the round-off is on the bill, lines
// and GST are not rounded. Returns reverse the original bill rounding.
let t: TestApp;
let admin: string;
beforeAll(async () => { t = await startApp(); admin = await t.login(); });
afterAll(async () => {
  await t.call('PATCH', '/business/settings', admin, { roundOffMode: 'NONE' });
  await t.close();
});

describe('round-off', () => {
  it('rounds the bill to the rupee when the business asks for it', async () => {
    const ctx = await t.branchWithRegister(admin);
    // 412.37 + 18% GST = 486.60.
    const item = await t.item(ctx.token, ctx.branch.id, { sellPrice: 412.37, taxRate: 18 });
    const sale = (amount: number) =>
      t.call('POST', '/sales/checkout', ctx.token, checkoutBody(ctx.branch.id, ctx.walkIn.id, [line(item.id, { rate: 412.37, taxRate: 18 })], [{ mode: 'CASH', amount }]));

    const unrounded = await sale(486.6);
    expect(unrounded.status).toBe(200);
    expect(unrounded.body.invoice).toMatchObject({ grandTotal: '486.6', roundOff: '0' });

    await t.ok('PATCH', '/business/settings', admin, { roundOffMode: 'NEAREST_1' });
    expect((await t.ok('GET', '/business/settings', admin)).roundOffMode).toBe('NEAREST_1');
    expect((await sale(486.6)).status).toBe(400); // walk-ins pay the rounded total
    const rounded = await sale(487);
    expect(rounded.status).toBe(200);
    expect(rounded.body.invoice).toMatchObject({ status: 'SETTLED', grandTotal: '487', roundOff: '0.4', taxTotal: '74.23' });
    expect(rounded.body.invoice.lines[0]).toMatchObject({ netAmount: '486.6', taxableAmount: '412.37' });

    // A full return gives back what was billed, preserving the original tax amounts.
    const ret = await t.ok('POST', `/sales/${rounded.body.invoice.id}/return`, ctx.token, {
      lines: [{ saleLineId: rounded.body.invoice.lines[0].id, qty: 1 }],
      refundMode: 'CASH',
      reason: 'Test return'
    });
    expect(Number(ret.refundAmount)).toBe(487);
    expect(Number(ret.roundOff)).toBe(0.4);
    expect(Number(ret.taxTotal)).toBe(74.23);
    expect((await t.call('PATCH', '/business/settings', admin, { roundOffMode: 'NEAREST_5' })).status).toBe(400);
  });

  it.each([100.4, 100.6])('reverses a full return of a ₹%s bill, paid, partly paid or unpaid', async (rate) => {
    const ctx = await t.branchWithRegister(admin);
    const item = await t.item(ctx.token, ctx.branch.id, { sellPrice: rate, taxRate: 18, taxMode: 'INCLUSIVE' });
    const customer = await t.ok('POST', '/customers', ctx.token, { branchId: ctx.branch.id, name: 'Rounded credit customer' });
    const rounded = Math.round(rate);
    for (const paid of [rounded, 50, 0]) {
      const sale = await t.ok('POST', '/sales/checkout', ctx.token, checkoutBody(ctx.branch.id, customer.id,
        [line(item.id, { rate, taxRate: 18, taxMode: 'INCLUSIVE' })], paid ? [{ mode: 'CASH', amount: paid }] : []));
      const ret = await t.ok('POST', `/sales/${sale.invoice.id}/return`, ctx.token, {
        lines: [{ saleLineId: sale.invoice.lines[0].id, qty: 1 }], refundMode: 'CASH', reason: 'Rounded full return'
      });
      expect(Number(ret.totalAmount)).toBe(rounded);
      expect(Number(ret.dueAdjusted)).toBe(rounded - paid);
      expect(Number(ret.refundAmount)).toBe(paid);
      expect(Number(ret.roundOff)).toBeCloseTo(rounded - rate, 2);
      expect(Number(ret.taxTotal)).toBe(Number(sale.invoice.taxTotal));
      const invoice = await t.ok('GET', `/sales/${sale.invoice.id}`, ctx.token);
      expect(invoice.status).toBe('SETTLED');
      expect(Number(invoice.returnedRoundOff)).toBe(Number(ret.roundOff));
      const detail = await t.ok('GET', `/returns/${ret.id}`, ctx.token);
      expect(Number(detail.roundOff)).toBe(Number(ret.roundOff));
    }
  });

  it.each([33.46, 33.54])('reconciles repeated one-unit returns of a rounded bill at ₹%s per unit', async (rate) => {
    const ctx = await t.branchWithRegister(admin);
    const item = await t.item(ctx.token, ctx.branch.id, { sellPrice: rate, taxRate: 18, taxMode: 'INCLUSIVE' });
    const sale = await t.ok('POST', '/sales/checkout', ctx.token, checkoutBody(ctx.branch.id, ctx.walkIn.id,
      [line(item.id, { qty: 3, rate, taxRate: 18, taxMode: 'INCLUSIVE' })], [{ mode: 'CASH', amount: Math.round(rate * 3) }]));
    const returns = [];
    for (let i = 0; i < 3; i++) returns.push(await t.ok('POST', `/sales/${sale.invoice.id}/return`, ctx.token, {
      lines: [{ saleLineId: sale.invoice.lines[0].id, qty: 1 }], refundMode: 'CASH', reason: 'Rounded partial return'
    }));
    const sum = (key: string) => Math.round(returns.reduce((total, ret) => total + Number(ret[key]), 0) * 100) / 100;
    expect(sum('refundAmount')).toBe(Number(sale.invoice.grandTotal));
    expect(sum('roundOff')).toBe(Number(sale.invoice.roundOff));
    expect(sum('taxTotal')).toBe(Number(sale.invoice.taxTotal));
    expect(sum('taxableTotal')).toBe(Number(sale.invoice.lines[0].taxableAmount));
  });

  it('includes reversed rounding once in reports and credit-note exports for a multi-line return', async () => {
    const ctx = await t.branchWithRegister(admin);
    const item = await t.item(ctx.token, ctx.branch.id, { sellPrice: 100.4, taxRate: 18, taxMode: 'INCLUSIVE', costPrice: 50 });
    const sale = await t.ok('POST', '/sales/checkout', ctx.token, checkoutBody(ctx.branch.id, ctx.walkIn.id,
      [line(item.id, { rate: 100.4, taxRate: 18, taxMode: 'INCLUSIVE' }),
        line(item.id, { rate: 33.46, taxRate: 18, taxMode: 'INCLUSIVE' })], [{ mode: 'CASH', amount: 134 }]));
    const ret = await t.ok('POST', `/sales/${sale.invoice.id}/return`, ctx.token, {
      lines: sale.invoice.lines.map((row: { id: string }) => ({ saleLineId: row.id, qty: 1 })),
      refundMode: 'CASH', reason: 'Multi-line rounded full return'
    });
    expect(Number(ret.roundOff)).toBe(0.14);
    const report = await t.ok('GET', `/reports/sales-summary?branchId=${ctx.branch.id}`, ctx.token);
    expect(report.ranges.find((range: { label: string }) => range.label === 'Overall')).toMatchObject({
      grossSales: 134, returnsGross: 134, returnsNet: 113.58, netSales: 0, costOfGoodsSold: 0, grossProfit: 0
    });
    const { timezone } = await t.ok('GET', '/business/settings', admin);
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(ret.createdAt));
    const csv = await fetch(`${t.baseUrl}/exports/sales.csv?branchId=${ctx.branch.id}&from=${day}&to=${day}`, {
      headers: { authorization: `Bearer ${admin}` }
    });
    expect(csv.status).toBe(200);
    const credit = (await csv.text()).split('\r\n').find((row) => row.startsWith('Credit note,'))!.split(',');
    expect(Number(credit[13])).toBe(-0.14);
    expect(Number(credit[14])).toBe(-134);
    expect(Number(credit[18])).toBe(134);
  });
});
