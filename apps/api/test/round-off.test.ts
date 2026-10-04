import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkoutBody, line, startApp, type TestApp } from './helpers';

// A bill's total rounded to the rupee (a business setting): the round-off is on the bill, lines
// and GST are not rounded, and returns refund what the lines were worth.
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

    // A return gives back what the goods were worth.
    const ret = await t.ok('POST', `/sales/${rounded.body.invoice.id}/return`, ctx.token, {
      lines: [{ saleLineId: rounded.body.invoice.lines[0].id, qty: 1 }],
      refundMode: 'CASH',
      reason: 'Test return'
    });
    expect(Number(ret.refundAmount)).toBe(486.6);
    expect((await t.call('PATCH', '/business/settings', admin, { roundOffMode: 'NEAREST_5' })).status).toBe(400);
  });
});
