import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gstinCheckCharacter } from '@pos/contracts';
import { checkoutBody, line, startApp, type TestApp } from './helpers';

// GST #37: GSTR-1 from real sales and returns, through the API.
let t: TestApp;
let admin: string;
let month: string;
const GSTIN = (() => {
  const first14 = `29GSTRA${String(Date.now()).slice(-4)}B1Z`;
  return first14 + gstinCheckCharacter(first14);
})();
const query = (from: string, to = from, gstin = GSTIN) => `/gst/gstr1?gstin=${gstin}&from=${from}&to=${to}`;

beforeAll(async () => {
  t = await startApp();
  admin = await t.login();
  await t.db.taxpayerTypeChange.deleteMany({});
  const timeZone = (await t.ok('GET', '/business/settings', admin)).timezone;
  month = new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date()).slice(0, 7);

  // A Karnataka branch with its GSTIN, selling a phone (HSN 8517, 18%) and rice (exempt).
  const ctx = await t.branchWithRegister(admin);
  await t.ok('PATCH', `/branches/${ctx.branch.id}`, admin, { gstin: GSTIN });
  const phone = await t.ok('POST', '/items', ctx.token, { code: `P${randomUUID().slice(0, 8)}`, name: 'Phone', uom: 'NOS', sellPrice: 1000, taxRate: 18, hsnCode: '8517' });
  const rice = await t.ok('POST', '/items', ctx.token, { code: `R${randomUUID().slice(0, 8)}`, name: 'Rice', uom: 'Kg', sellPrice: 50, taxRate: 0, supplyType: 'EXEMPT', hsnCode: '1006' });
  for (const item of [phone, rice]) await t.ok('POST', '/stock/opening', ctx.token, { branchId: ctx.branch.id, itemId: item.id, qty: 500 });
  const sell = async (lines: unknown[], total: number, extra: Record<string, unknown> = {}) =>
    (await t.ok('POST', '/sales/checkout', ctx.token, checkoutBody(ctx.branch.id, ctx.walkIn.id, lines, [{ mode: 'CASH', amount: total }], extra))).invoice;

  // Counter sale: 2 phones (2000 + 360) and 4 kg rice (200, exempt).
  const counter = await sell([line(phone.id, { qty: 2, rate: 1000, taxRate: 18 }), line(rice.id, { qty: 4, rate: 50, taxRate: 0 })], 2560);
  // Shipped to Maharashtra: 1 phone (1000 + 180 IGST) and 150 phones (B2CL: 177,000).
  await sell([line(phone.id, { rate: 1000, taxRate: 18 })], 1180, { placeOfSupplyStateCode: '27' });
  await sell([line(phone.id, { qty: 150, rate: 1000, taxRate: 18 })], 177000, { placeOfSupplyStateCode: '27' });
  // One phone from the counter sale comes back.
  await t.ok('POST', `/sales/${counter.id}/return`, ctx.token, { refundMode: 'CASH', lines: [{ saleLineId: counter.lines[0].id, qty: 1 }] });
});
afterAll(async () => { await t.close(); });

describe('GSTR-1', () => {
  it('lists the GSTINs there is something to file for', async () => {
    const gstins = await t.ok('GET', '/gst/gstins', admin);
    expect(gstins.map((g: { gstin: string }) => g.gstin)).toContain(GSTIN);
  });

  it('builds the sections from the period’s sales and returns', async () => {
    const res = await t.ok('GET', query(month), admin);
    // Other test files leave sales without a GSTIN in this database, which only warn.
    expect(res.problems.filter((p: { severity: string }) => p.severity === 'error')).toEqual([]);
    const { json } = res;
    expect(json).toMatchObject({ gstin: GSTIN, fp: `${month.slice(5)}${month.slice(0, 4)}` });
    expect(json.b2cs).toEqual([
      { sply_ty: 'INTER', rt: 18, typ: 'OE', pos: '27', txval: 1000, iamt: 180, camt: 0, samt: 0, csamt: 0 },
      // 2 phones sold, 1 returned
      { sply_ty: 'INTRA', rt: 18, typ: 'OE', pos: '29', txval: 1000, iamt: 0, camt: 90, samt: 90, csamt: 0 }
    ]);
    expect(json.b2cl).toHaveLength(1);
    expect(json.b2cl[0]).toMatchObject({ pos: '27', inv: [{ val: 177000, itms: [{ num: 1, itm_det: { rt: 18, txval: 150000, iamt: 27000, csamt: 0 } }] }] });
    expect(json.nil).toEqual({ inv: [{ sply_ty: 'INTRAB2C', expt_amt: 200, nil_amt: 0, ngsup_amt: 0 }] });
    expect(json.hsn.hsn_b2c).toEqual([
      { num: 1, hsn_sc: '1006', desc: 'Rice', uqc: 'KGS', qty: 4, rt: 0, txval: 200, iamt: 0, camt: 0, samt: 0, csamt: 0 },
      { num: 2, hsn_sc: '8517', desc: 'Phone', uqc: 'NOS', qty: 152, rt: 18, txval: 152000, iamt: 27180, camt: 90, samt: 90, csamt: 0 }
    ]);
    const [invoices, credit] = json.doc_issue.doc_det;
    expect(invoices).toMatchObject({ doc_num: 1, docs: [{ totnum: 3, cancel: 0, net_issue: 3 }] });
    expect(invoices.docs[0].from).toMatch(/\/00001$/);
    expect(invoices.docs[0].to).toMatch(/\/00003$/);
    expect(credit).toMatchObject({ doc_num: 5, doc_typ: 'Credit Note', docs: [{ totnum: 1 }] });
  });

  it('gives GSTR-3B Tables 3.1 and 3.2 from the same figures', async () => {
    const res = await t.ok('GET', `/gst/gstr3b?gstin=${GSTIN}&from=${month}&to=${month}`, admin);
    expect(res.table31.outwardTaxable).toEqual({ txval: 152000, iamt: 27180, camt: 90, samt: 90, csamt: 0 });
    expect(res.table31.outwardNilExempt.txval).toBe(200);
    expect(res.table32.unregistered).toEqual([{ pos: '27', txval: 151000, iamt: 27180 }]);
    expect((await t.call('GET', `/gst/gstr3b?gstin=${GSTIN}&from=2026-05&to=2026-07`, admin)).status).toBe(400);
  });

  it('accepts one month or a whole quarter, nothing else', async () => {
    expect((await t.call('GET', query('2026-04', '2026-06'), admin)).status).toBe(200);
    expect((await t.call('GET', query('2026-05', '2026-07'), admin)).status).toBe(400);
    expect((await t.call('GET', query('2026-04', '2026-05'), admin)).status).toBe(400);
    expect((await t.call('GET', query('2026-13'), admin)).status).toBe(400);
    expect((await t.call('GET', query(month, month, '29ABCDE1234F1ZZ'), admin)).status).toBe(400); // bad GSTIN
  });

  it('is for admins only', async () => {
    const c = await t.branchWithRegister(admin);
    const username = `gstr1-${Date.now()}`;
    await t.ok('POST', '/users', admin, { branchId: c.branch.id, username, password: 'cashier-pass-1' });
    expect((await t.call('GET', query(month), await t.login(username, 'cashier-pass-1'))).status).toBe(400);
  });
});
