import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkoutBody, line, startApp, type TestApp } from './helpers';

let t: TestApp;
let ctx: Awaited<ReturnType<TestApp['branchWithRegister']>>;
let itemId: string;
let originalGstin: string | null;
let today: string;
const changes: string[] = [];
beforeAll(async () => {
  t = await startApp();
  ctx = await t.branchWithRegister(await t.login());
  const settings = await t.ok('GET', '/business/settings', ctx.token);
  originalGstin = settings.gstNumber;
  today = new Intl.DateTimeFormat('en-CA', { timeZone: settings.timezone }).format(new Date());
  itemId = (await t.item(ctx.token, ctx.branch.id, { sellPrice: 118, taxRate: 18, taxMode: 'INCLUSIVE' })).id;
});
afterAll(async () => {
  await t.db.taxpayerTypeChange.deleteMany({ where: { id: { in: changes } } });
  await t.db.businessSettings.update({ where: { id: 'default' }, data: { gstNumber: originalGstin } });
  await t.close();
});

const sale = () => t.call('POST', '/sales/checkout', ctx.token, checkoutBody(ctx.branch.id, ctx.walkIn.id,
  [line(itemId, { rate: 118, taxRate: 18, taxMode: 'INCLUSIVE' })], [{ mode: 'CASH', amount: 118 }]));
async function change(taxpayerType: 'REGULAR' | 'UNREGISTERED') {
  const result = await t.ok('POST', '/business/taxpayer-type', ctx.token, { taxpayerType, effectiveDate: today });
  changes.push(result.history[0].id);
}

describe('unregistered retail billing', () => {
  it('charges no GST, keeps product classification, and preserves older registered invoices', async () => {
    const registered = await sale();
    expect(registered.status).toBe(200);
    expect(registered.body.invoice.documentType).toBe('TAX_INVOICE');
    await change('UNREGISTERED');
    const ordinary = await sale();
    expect(ordinary.status).toBe(200);
    expect(ordinary.body.invoice).toMatchObject({ taxpayerType: 'UNREGISTERED', documentType: 'INVOICE', sellerGstin: null, taxTotal: '0', grandTotal: '118' });
    expect(ordinary.body.invoice.lines[0]).toMatchObject({ taxRate: '0', taxMode: 'EXCLUSIVE', taxAmount: '0', netAmount: '118' });
    expect(Number((await t.db.item.findUniqueOrThrow({ where: { id: itemId } })).taxRate)).toBe(18);
    const historical = await t.ok('GET', `/sales/${registered.body.invoice.id}`, ctx.token);
    expect(historical.documentType).toBe('TAX_INVOICE');
    expect(historical.sellerGstin).toBe(registered.body.invoice.sellerGstin);
    expect(historical.taxTotal).toBe(registered.body.invoice.taxTotal);
    const returned = await t.ok('POST', `/sales/${ordinary.body.invoice.id}/return`, ctx.token, {
      refundMode: 'CASH', reason: 'Ordinary invoice return', lines: [{ saleLineId: ordinary.body.invoice.lines[0].id, qty: 1 }]
    });
    expect(Number(returned.refundAmount)).toBe(118);
    expect(Number(returned.taxTotal)).toBe(0);
  });

  it('requires seller registration when switching back to registered billing', async () => {
    await t.ok('PATCH', '/business/settings', ctx.token, { gstNumber: null });
    expect((await sale()).status).toBe(200); // Still unregistered.
    await change('REGULAR');
    const before = await t.db.saleInvoice.count();
    const rejected = await sale();
    expect(rejected.status).toBe(400);
    expect(rejected.body.message).toMatch(/seller GSTIN/);
    expect(await t.db.saleInvoice.count()).toBe(before);
    await t.ok('PATCH', '/business/settings', ctx.token, { gstNumber: originalGstin });
    expect((await sale()).status).toBe(200);
  });
});
