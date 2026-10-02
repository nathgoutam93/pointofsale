import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { financialYearStart, gstinCheckCharacter } from '@pos/contracts';
import { checkoutBody, line, startApp, type TestApp } from './helpers';

// GST #39: CMP-08 and GSTR-4 from real composition sales and returns.
let t: TestApp;
let admin: string;
let quarter: { from: string; to: string; number: number };
let fy: number;
const GSTIN = (() => {
  const first14 = `29CMPOS${String(Date.now()).slice(-4)}C1Z`;
  return first14 + gstinCheckCharacter(first14);
})();

beforeAll(async () => {
  t = await startApp();
  admin = await t.login();
  await t.db.taxpayerTypeChange.deleteMany({});
  const timeZone = (await t.ok('GET', '/business/settings', admin)).timezone;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
  const [year, month] = today.split('-').map(Number);
  fy = financialYearStart(year, month);
  const first = [4, 7, 10, 1][Math.floor(((month + 8) % 12) / 3)];
  const pad = (m: number) => String(m).padStart(2, '0');
  quarter = { from: `${year}-${pad(first)}`, to: `${year}-${pad(first + 2)}`, number: Math.floor(((month + 8) % 12) / 3) + 1 };

  const ctx = await t.branchWithRegister(admin);
  await t.ok('PATCH', `/branches/${ctx.branch.id}`, admin, { gstin: GSTIN });
  const phone = await t.ok('POST', '/items', ctx.token, { code: `P${randomUUID().slice(0, 8)}`, name: 'Phone', uom: 'NOS', sellPrice: 1000, taxRate: 18, hsnCode: '8517' });
  const rice = await t.ok('POST', '/items', ctx.token, { code: `R${randomUUID().slice(0, 8)}`, name: 'Rice', uom: 'Kg', sellPrice: 50, taxRate: 0, supplyType: 'EXEMPT', hsnCode: '1006' });
  for (const item of [phone, rice]) await t.ok('POST', '/stock/opening', ctx.token, { branchId: ctx.branch.id, itemId: item.id, qty: 100 });
  const sell = async (lines: unknown[], total: number) =>
    (await t.ok('POST', '/sales/checkout', ctx.token, checkoutBody(ctx.branch.id, ctx.walkIn.id, lines, [{ mode: 'CASH', amount: total }]))).invoice;

  // One regular sale first (1000 + 180), then composition from today.
  await sell([line(phone.id, { rate: 1000, taxRate: 18 })], 1180);
  await t.ok('POST', '/business/taxpayer-type', admin, { taxpayerType: 'COMPOSITION', compositionCategory: 'TRADER', effectiveDate: today });
  // Composition: 3 phones at 1000 (no GST) and 4 kg rice (exempt); one phone comes back.
  const sale = await sell([line(phone.id, { qty: 3, rate: 1000, taxRate: 18 }), line(rice.id, { qty: 4, rate: 50, taxRate: 0 })], 3200);
  await t.ok('POST', `/sales/${sale.id}/return`, ctx.token, { refundMode: 'CASH', lines: [{ saleLineId: sale.lines[0].id, qty: 1 }] });
});
afterAll(async () => {
  await t.db.taxpayerTypeChange.deleteMany({});
  await t.close();
});

describe('composition returns', () => {
  it('CMP-08: the quarter’s composition turnover and 1% tax on taxable supplies', async () => {
    const res = await t.ok('GET', `/gst/cmp08?gstin=${GSTIN}&from=${quarter.from}&to=${quarter.to}`, admin);
    // Turnover 2000 (phones, net of the return) + 200 (rice); tax on 2000 at 1%.
    expect(res.rows).toEqual([{ category: 'TRADER', rate: 1, turnover: 2200, taxableTurnover: 2000, taxBase: 2000, cgst: 10, sgst: 10 }]);
    expect(res.totals).toEqual({ turnover: 2200, taxBase: 2000, cgst: 10, sgst: 10 });
    const messages = res.problems.map((p: { message: string }) => p.message).join(' | ');
    expect(messages).toMatch(/1 sale\(s\) made as a regular taxpayer are left out/);
    expect(messages).toMatch(/purchases are not recorded/);
    expect(res.yearTurnover).toBeGreaterThan(0);
  });

  it('GSTR-4: the financial year, with this quarter’s figures in its place', async () => {
    const res = await t.ok('GET', `/gst/gstr4?gstin=${GSTIN}&fy=${fy}`, admin);
    expect(res.totals).toEqual({ turnover: 2200, taxBase: 2000, cgst: 10, sgst: 10 });
    expect(res.byQuarter).toHaveLength(4);
    expect(res.byQuarter[quarter.number - 1]).toEqual({ quarter: quarter.number, turnover: 2200, taxBase: 2000, cgst: 10, sgst: 10 });
  });

  it('CMP-08 is for a quarter only', async () => {
    expect((await t.call('GET', `/gst/cmp08?gstin=${GSTIN}&from=${quarter.from}&to=${quarter.from}`, admin)).status).toBe(400);
    expect((await t.call('GET', `/gst/gstr4?gstin=${GSTIN}&fy=1999`, admin)).status).toBe(400);
  });
});
