import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { line, startApp, type TestApp } from './helpers';

// #5 / #6: the server prices each line from the item; cashiers have a discount limit.
let t: TestApp;
let admin: string;
let ctx: Awaited<ReturnType<TestApp['branchWithRegister']>>;
let phone: { id: string };
beforeAll(async () => {
  t = await startApp();
  admin = await t.login();
  await t.ok('PATCH', '/business/settings', admin, { cashierMaxDiscountPercent: 10 });
  ctx = await t.branchWithRegister(admin);
  phone = await t.item(ctx.token, ctx.branch.id, {
    sellPrice: 5000,
    taxRate: 18,
    saleUoms: [{ uom: 'BOX', conversionQty: 10, sellPrice: 45000 }],
    stock: 500
  });
});
afterAll(async () => { await t.close(); });

const phoneLine = (o: Record<string, unknown> = {}) => line(phone.id, { rate: 5000, taxRate: 18, ...o });

async function asCashier() {
  // A cashier with their own branch and register.
  const c = await t.branchWithRegister(admin);
  const username = `cash-${Date.now()}`;
  await t.ok('POST', '/users', admin, { branchId: c.branch.id, username, password: 'cashier-pass-1' });
  await t.ok('POST', '/registers/close', c.token, { closingBalance: 0 });
  const base = await t.login(username, 'cashier-pass-1');
  const opened = await t.ok('POST', '/registers/open', base, { branchId: c.branch.id, openingBalance: 0 });
  // Stock for the cashier's branch (opening stock needs that branch's open register).
  await t.db.stockLedger.create({ data: { branchId: c.branch.id, itemId: phone.id, txnType: 'OPENING', qtyIn: 100, qtyOut: 0 } });
  return { token: opened.token, branchId: c.branch.id, walkInId: c.walkIn.id };
}

describe('server-side pricing', () => {
  const sale = (lines: unknown[], discounts: unknown[] = [], token = ctx.token, branchId = ctx.branch.id, customerId = ctx.walkIn.id) =>
    t.call('POST', '/sales', token, { branchId, customerId, lines, discounts });

  it('rejects stale tax, wrong unit sizes, unknown units and prices above list', async () => {
    expect((await sale([phoneLine({ taxRate: 0 })])).status).toBe(400);
    expect((await sale([phoneLine({ taxMode: 'INCLUSIVE' })])).status).toBe(400);
    expect((await sale([phoneLine({ rate: 6000 })])).status).toBe(400);
    expect((await sale([phoneLine({ saleUom: 'BOX', saleUomQty: 1, saleUomConversionQty: 1, qty: 1, rate: 45000 })])).status).toBe(400);
    expect((await sale([phoneLine({ saleUom: 'CRATE', saleUomQty: 1, saleUomConversionQty: 10, qty: 10 })])).status).toBe(400);
  });

  it('records the list price and works out tax from the item', async () => {
    const res = await sale([phoneLine({ rate: 4500 })]);
    expect(res.status).toBe(201);
    expect(Number(res.body.lines[0].listRate)).toBe(5000);
    expect(Number(res.body.grandTotal)).toBe(5310);
  });

  it('prices a box at the box price with the conversion from the database', async () => {
    const res = await sale([phoneLine({ saleUom: 'BOX', saleUomQty: 1, saleUomConversionQty: 10, qty: 10, rate: 45000 })]);
    expect(res.status).toBe(201);
    expect(Number(res.body.lines[0].qty)).toBe(10);
  });

  it('keeps a tax-inclusive ₹100 at 18% at ₹100.00', async () => {
    const incl = await t.item(ctx.token, ctx.branch.id, { sellPrice: 100, taxRate: 18, taxMode: 'INCLUSIVE' });
    const res = await sale([line(incl.id, { taxRate: 18, taxMode: 'INCLUSIVE' })]);
    expect(Number(res.body.taxTotal)).toBe(15.25);
    expect(Number(res.body.grandTotal)).toBe(100);
  });

  it('lets admins go below list price without a limit', async () => {
    expect((await sale([phoneLine({ rate: 0.01 })])).status).toBe(201);
  });

  it('limits cashiers to the business discount limit', async () => {
    const c = await asCashier();
    const as = (lines: unknown[], discounts: unknown[] = []) => sale(lines, discounts, c.token, c.branchId, c.walkInId);
    expect((await as([phoneLine({ rate: 0.01 })])).status).toBe(400);
    expect((await as([phoneLine({ rate: 4500 })])).status).toBe(201); // exactly 10%
    expect((await as([phoneLine()], [{ type: 'PERCENTAGE', value: 15 }])).status).toBe(400);
    expect((await as([phoneLine({ rate: 4600, discounts: [{ type: 'FIXED', value: 200 }] })])).status).toBe(400); // 8% + 4%
    await t.ok('PATCH', '/business/settings', admin, { cashierMaxDiscountPercent: 20 });
    expect((await as([phoneLine()], [{ type: 'PERCENTAGE', value: 15 }])).status).toBe(201);
    await t.ok('PATCH', '/business/settings', admin, { cashierMaxDiscountPercent: 10 });
    expect((await t.call('PATCH', '/business/settings', c.token, { cashierMaxDiscountPercent: 100 })).status).toBe(400);
  });
});
