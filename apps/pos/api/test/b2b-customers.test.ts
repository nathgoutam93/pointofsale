import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gstinCheckCharacter } from '@pos/contracts';
import { mailOutbox } from '../src/mail/mailer';
import { checkoutBody, line, startApp, type TestApp } from './helpers';

// Registered (B2B) buyers: their GSTIN and address on the customer, recorded on each bill, on
// the receipt, and in GSTR-1's B2B and CDNR sections.
let t: TestApp;
let admin: string;
let ctx: Awaited<ReturnType<TestApp['branchWithRegister']>>;
let phoneId: string;
let month: string;
const gstin = (prefix: string) => {
  const first14 = `${prefix}${String(Date.now()).slice(-4)}B1Z`;
  return first14 + gstinCheckCharacter(first14);
};
const SELLER = gstin('29BTOBS');
const BUYER = gstin('27BUYER');

beforeAll(async () => {
  process.env.MAIL_TRANSPORT = 'memory';
  t = await startApp();
  admin = await t.login();
  await t.db.taxpayerTypeChange.deleteMany({});
  const timeZone = (await t.ok('GET', '/business/settings', admin)).timezone;
  month = new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date()).slice(0, 7);
  ctx = await t.branchWithRegister(admin);
  await t.ok('PATCH', `/branches/${ctx.branch.id}`, admin, { gstin: SELLER });
  const phone = await t.ok('POST', '/items', ctx.token, { code: `P${randomUUID().slice(0, 8)}`, name: 'Phone', uom: 'NOS', sellPrice: 1000, taxRate: 18, hsnCode: '8517' });
  phoneId = phone.id;
  await t.ok('POST', '/stock/opening', ctx.token, { branchId: ctx.branch.id, itemId: phoneId, qty: 100 });
});
afterAll(async () => {
  delete process.env.MAIL_TRANSPORT;
  await t.close();
});

describe('registered buyers', () => {
  it('keep a validated GSTIN, address and email on the customer', async () => {
    const bad = await t.call('POST', '/customers', ctx.token, { branchId: ctx.branch.id, name: 'Typo Traders', gstin: `${BUYER.slice(0, 14)}0` });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toMatch(/check character/);
    expect((await t.call('POST', '/customers', ctx.token, { branchId: ctx.branch.id, name: 'Mail', email: 'not-an-email' })).status).toBe(400);

    const customer = await t.ok('POST', '/customers', ctx.token, {
      branchId: ctx.branch.id,
      name: 'Rao Traders',
      gstin: BUYER.toLowerCase(),
      address: '12 MG Road\nPune 411001',
      email: 'accounts@rao.example'
    });
    expect(customer).toMatchObject({ gstin: BUYER, address: '12 MG Road\nPune 411001', email: 'accounts@rao.example' });

    // Cleared with null or an empty value.
    const cleared = await t.ok('PATCH', `/customers/${customer.id}`, ctx.token, { gstin: '', email: null });
    expect(cleared).toMatchObject({ gstin: null, email: null, address: '12 MG Road\nPune 411001' });
    await t.ok('PATCH', `/customers/${customer.id}`, ctx.token, { gstin: BUYER });
  });

  it("have their GSTIN and address recorded on the bill, printed on its receipt and in GSTR-1's B2B section", async () => {
    const customer = (await t.ok('GET', `/customers?branchId=${ctx.branch.id}`, ctx.token)).find((c: { name: string }) => c.name === 'Rao Traders');
    // Shipped to the buyer in Maharashtra: IGST, with their order number.
    const { invoice } = await t.ok(
      'POST',
      '/sales/checkout',
      ctx.token,
      checkoutBody(ctx.branch.id, customer.id, [line(phoneId, { qty: 2, rate: 1000, taxRate: 18 })], [{ mode: 'CASH', amount: 2360 }], {
        placeOfSupplyStateCode: '27',
        reference: 'PO-7781'
      })
    );
    expect(invoice).toMatchObject({ customerName: 'Rao Traders', buyerGstin: BUYER, buyerAddress: '12 MG Road\nPune 411001', reference: 'PO-7781' });

    // A later change to the customer doesn't change the bill.
    await t.ok('PATCH', `/customers/${customer.id}`, ctx.token, { address: 'New address' });
    expect(await t.ok('GET', `/sales/${invoice.id}`, ctx.token)).toMatchObject({ buyerAddress: '12 MG Road\nPune 411001' });

    // The emailed receipt carries the buyer's details.
    mailOutbox.length = 0;
    await t.ok('POST', `/sales/${invoice.id}/email-receipt`, ctx.token, { email: 'accounts@rao.example' });
    const text = mailOutbox.at(-1)!.text;
    expect(text).toMatch(/Buyer: Rao Traders/);
    expect(text).toContain(BUYER);
    expect(text).toMatch(/Address: 12 MG Road, Pune 411001/);
    expect(text).toMatch(/Ref: PO-7781/);

    // One phone comes back: a credit note to the registered buyer.
    await t.ok('POST', `/sales/${invoice.id}/return`, ctx.token, { refundMode: 'CASH', reason: 'Test return', lines: [{ saleLineId: invoice.lines[0].id, qty: 1 }] });

    const { json } = await t.ok('GET', `/gst/gstr1?gstin=${SELLER}&from=${month}&to=${month}`, admin);
    expect(json.b2b).toEqual([
      {
        ctin: BUYER,
        inv: [expect.objectContaining({ inum: invoice.invoiceNo, val: 2360, pos: '27', rchrg: 'N', inv_typ: 'R', itms: [{ num: 1, itm_det: { rt: 18, txval: 2000, iamt: 360, camt: 0, samt: 0, csamt: 0 } }] })]
      }
    ]);
    expect(json.cdnr).toEqual([
      { ctin: BUYER, nt: [expect.objectContaining({ ntty: 'C', pos: '27', val: 1180, itms: [{ num: 1, itm_det: { rt: 18, txval: 1000, iamt: 180, camt: 0, samt: 0, csamt: 0 } }] })] }
    ]);
    expect(json.b2cs).toBeUndefined();
    expect(json.hsn).toEqual({ hsn_b2b: [{ num: 1, hsn_sc: '8517', desc: 'Phone', uqc: 'NOS', qty: 1, rt: 18, txval: 1000, iamt: 180, camt: 0, samt: 0, csamt: 0 }] });

    const gstr3b = await t.ok('GET', `/gst/gstr3b?gstin=${SELLER}&from=${month}&to=${month}`, admin);
    expect(gstr3b.table31.outwardTaxable).toMatchObject({ txval: 1000, iamt: 180 });
    expect(gstr3b.table32.unregistered).toEqual([]);
  });

  it('a walk-in sale carries no buyer details', async () => {
    const { invoice } = await t.ok('POST', '/sales/checkout', ctx.token, checkoutBody(ctx.branch.id, ctx.walkIn.id, [line(phoneId, { rate: 1000, taxRate: 18 })], [{ mode: 'CASH', amount: 1180 }]));
    expect(invoice).toMatchObject({ buyerGstin: null, buyerAddress: null, reference: null });
  });
});
