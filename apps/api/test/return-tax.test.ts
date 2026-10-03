import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkoutBody, line, startApp, type TestApp } from './helpers';

// GST #34: each return line stores its refund's taxable value and tax by kind.
let t: TestApp;
let admin: string;
let ctx: Awaited<ReturnType<TestApp['branchWithRegister']>>;
let itemId: string;

const parts = (row: Record<string, unknown>) =>
  ['taxableAmount', 'cgstAmount', 'sgstAmount', 'igstAmount', 'taxAmount', 'amount'].map((key) => Number(row[key]));
const totals = (row: Record<string, unknown>) =>
  ['taxableTotal', 'cgstTotal', 'sgstTotal', 'igstTotal', 'taxTotal', 'totalAmount'].map((key) => Number(row[key]));

/** A paid sale of `qty` units of ₹100 including 18%. */
async function sale(qty: number, extra: Record<string, unknown> = {}) {
  const lines = [line(itemId, { qty, taxRate: 18, taxMode: 'INCLUSIVE' })];
  return (await t.ok('POST', '/sales/checkout', ctx.token, checkoutBody(ctx.branch.id, ctx.walkIn.id, lines, [{ mode: 'CASH', amount: 100 * qty }], extra))).invoice;
}
const ret = (invoice: { id: string; lines: Array<{ id: string }> }, qty: number) =>
  t.ok('POST', `/sales/${invoice.id}/return`, ctx.token, { refundMode: 'CASH', lines: [{ saleLineId: invoice.lines[0].id, qty }] });

beforeAll(async () => {
  t = await startApp();
  admin = await t.login();
  ctx = await t.branchWithRegister(admin);
  await t.ok('PATCH', `/branches/${ctx.branch.id}`, admin, { stateCode: '29' });
  itemId = (await t.item(ctx.token, ctx.branch.id, { sellPrice: 100, taxRate: 18, taxMode: 'INCLUSIVE' })).id;
});
afterAll(async () => { await t.close(); });

describe('return tax parts', () => {
  it('splits a refund into taxable value, CGST and SGST that add back up to the sale line', async () => {
    // 2 × ₹100 incl. 18%: taxable 169.49, tax 30.51 = CGST 15.25 + SGST 15.26.
    const invoice = await sale(2);
    expect([invoice.lines[0].taxableAmount, invoice.lines[0].cgstAmount, invoice.lines[0].sgstAmount].map(Number)).toEqual([169.49, 15.25, 15.26]);

    const first = await ret(invoice, 1);
    const firstDetail = await t.ok('GET', `/returns/${first.id}`, ctx.token);
    expect(parts(firstDetail.lines[0])).toEqual([84.75, 7.63, 7.63, 0, 15.26, 100.01]);
    expect(totals(first)).toEqual([84.75, 7.63, 7.63, 0, 15.26, 100.01]);

    const second = await ret(invoice, 1);
    expect(totals(second)).toEqual([84.74, 7.62, 7.63, 0, 15.25, 99.99]);
    // Together: exactly the sale line.
    expect([84.75 + 84.74, 7.63 + 7.62, 7.63 + 7.63].map((v) => Math.round(v * 100) / 100)).toEqual([169.49, 15.25, 15.26]);
  });

  it('refunds IGST for goods that went to another state', async () => {
    const invoice = await sale(1, { placeOfSupplyStateCode: '27' });
    const refund = await ret(invoice, 1);
    expect(totals(refund)).toEqual([84.75, 0, 0, 15.25, 15.25, 100]);
  });

  it('shows the parts already returned with the sale, for the Returns page', async () => {
    const invoice = await sale(3);
    await ret(invoice, 1);
    const detail = await t.ok('GET', `/sales/${invoice.id}`, ctx.token);
    const returned = detail.lines[0].returnLines[0];
    // 3 × ₹100 incl. 18%: taxable 254.24, tax 45.76 = 22.88 + 22.88; a third of each.
    expect(parts(returned)).toEqual([84.75, 7.63, 7.63, 0, 15.26, 100.01]);
  });
});
