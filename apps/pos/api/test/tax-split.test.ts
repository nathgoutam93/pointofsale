import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkoutBody, line, startApp, type TestApp } from './helpers';

// GST #33: each sale line and invoice stores its tax as CGST + SGST (within a state) or IGST.
let t: TestApp;
let admin: string;

const money = (value: unknown) => Number(value);
const split = (row: { cgstAmount?: unknown; sgstAmount?: unknown; igstAmount?: unknown; cgstTotal?: unknown; sgstTotal?: unknown; igstTotal?: unknown }) =>
  'cgstTotal' in row
    ? [money(row.cgstTotal), money(row.sgstTotal), money(row.igstTotal)]
    : [money(row.cgstAmount), money(row.sgstAmount), money(row.igstAmount)];

async function shop(stateCode: string | null) {
  const ctx = await t.branchWithRegister(admin);
  if (stateCode) await t.ok('PATCH', `/branches/${ctx.branch.id}`, admin, { stateCode });
  const inclusive = await t.item(ctx.token, ctx.branch.id, { sellPrice: 100, taxRate: 18, taxMode: 'INCLUSIVE' });
  const exclusive = await t.item(ctx.token, ctx.branch.id, { sellPrice: 100, taxRate: 5 });
  // 100 incl. 18% (tax 15.25) + 100 + 5% (tax 5.00) = 205.00
  const sell = async (extra: Record<string, unknown> = {}) => {
    const lines = [line(inclusive.id, { taxRate: 18, taxMode: 'INCLUSIVE' }), line(exclusive.id, { taxRate: 5 })];
    const { invoice } = await t.ok('POST', '/sales/checkout', ctx.token, checkoutBody(ctx.branch.id, ctx.walkIn.id, lines, [{ mode: 'CASH', amount: 205 }], extra));
    return invoice;
  };
  return { ...ctx, sell };
}

beforeAll(async () => {
  t = await startApp();
  admin = await t.login();
  await t.db.taxpayerTypeChange.deleteMany({});
});
afterAll(async () => {
  await t.db.taxpayerTypeChange.deleteMany({});
  await t.close();
});

describe('tax split', () => {
  it('splits a counter sale into CGST and SGST that add up to the tax', async () => {
    const invoice = await (await shop('29')).sell();
    expect(invoice.lines.map(split)).toEqual([[7.62, 7.63, 0], [2.5, 2.5, 0]]);
    expect(split(invoice)).toEqual([10.12, 10.13, 0]);
    expect(money(invoice.taxTotal)).toBe(20.25);
  });

  it('makes goods shipped to another state all IGST', async () => {
    const invoice = await (await shop('29')).sell({ placeOfSupplyStateCode: '27' });
    expect(invoice.lines.map(split)).toEqual([[0, 0, 15.25], [0, 0, 5]]);
    expect(split(invoice)).toEqual([0, 0, 20.25]);
  });

  it('treats a branch without a state as selling within its state', async () => {
    const invoice = await (await shop(null)).sell();
    expect(split(invoice)).toEqual([10.12, 10.13, 0]);
  });

  it('has nothing to split for a composition taxpayer', async () => {
    const s = await shop('29');
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: (await t.ok('GET', '/business/settings', admin)).timezone }).format(new Date());
    await t.ok('POST', '/business/taxpayer-type', admin, { taxpayerType: 'COMPOSITION', compositionCategory: 'TRADER', effectiveDate: today });
    const lines = [line((await t.item(s.token, s.branch.id, { sellPrice: 100, taxRate: 18 })).id, { taxRate: 18 })];
    const { invoice } = await t.ok('POST', '/sales/checkout', s.token, checkoutBody(s.branch.id, s.walkIn.id, lines, [{ mode: 'CASH', amount: 100 }]));
    expect(split(invoice)).toEqual([0, 0, 0]);
    await t.db.taxpayerTypeChange.deleteMany({});
  });

  it('refuses a split that does not add up, or mixes CGST with IGST', async () => {
    const invoice = await (await shop('29')).sell();
    const lineId = invoice.lines[0].id;
    await expect(t.db.saleInvoiceLine.update({ where: { id: lineId }, data: { cgstAmount: 7.63 } })).rejects.toThrow(/gst_split_check/);
    await expect(
      t.db.saleInvoiceLine.update({ where: { id: lineId }, data: { cgstAmount: 0, sgstAmount: 7.63, igstAmount: 7.62 } })
    ).rejects.toThrow(/gst_split_check/);
  });
});
