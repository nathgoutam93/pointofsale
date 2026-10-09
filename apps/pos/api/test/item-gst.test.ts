import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkoutBody, line, startApp, type TestApp } from './helpers';

// GST #32: HSN code, GST unit (UQC) and supply type on items, copied onto each sale line.
let t: TestApp;
let admin: string;

const newItem = (body: Record<string, unknown>) =>
  t.call('POST', '/items', admin, {
    code: `G${randomUUID().slice(0, 10)}`,
    name: `GST item ${randomUUID().slice(0, 6)}`,
    uom: 'PCS',
    sellPrice: 100,
    taxRate: 18,
    ...body
  });
const patchItem = (id: string, body: Record<string, unknown>) => t.call('PATCH', `/items/${id}`, admin, body);

beforeAll(async () => {
  t = await startApp();
  admin = await t.login();
  await t.ok('PATCH', '/business/settings', admin, { hsnMinDigits: 4 });
});
afterAll(async () => {
  await t.ok('PATCH', '/business/settings', admin, { hsnMinDigits: 4 });
  await t.close();
});

describe('item GST details', () => {
  it('defaults the supply type from the rate and the GST unit from the unit name', async () => {
    expect((await newItem({ taxRate: 18 })).body).toMatchObject({ supplyType: 'TAXABLE', uqc: 'PCS', hsnCode: null });
    expect((await newItem({ taxRate: 0, uom: 'Kg' })).body).toMatchObject({ supplyType: 'NIL_RATED', uqc: 'KGS' });
    expect((await newItem({ uom: 'Tray' })).body.uqc).toBeNull();
  });

  it('rejects a supply type that disagrees with the rate', async () => {
    const exempt18 = await newItem({ supplyType: 'EXEMPT', taxRate: 18 });
    expect(exempt18.status).toBe(400);
    expect(String(exempt18.body.message)).toMatch(/exempt item has no tax/);
    expect((await newItem({ supplyType: 'TAXABLE', taxRate: 0 })).status).toBe(400);
    expect((await newItem({ supplyType: 'EXEMPT', taxRate: 0 })).body.supplyType).toBe('EXEMPT');
  });

  it('checks HSN codes against the business minimum length', async () => {
    expect((await newItem({ hsnCode: '10063' })).status).toBe(400);
    expect((await newItem({ hsnCode: '1006' })).body.hsnCode).toBe('1006');
    await t.ok('PATCH', '/business/settings', admin, { hsnMinDigits: 6 });
    const short = await newItem({ hsnCode: '1006' });
    expect(short.status).toBe(400);
    expect(String(short.body.message)).toMatch(/at least 6 digits/);
    expect((await newItem({ hsnCode: '100630' })).body.hsnCode).toBe('100630');
    expect((await t.call('PATCH', '/business/settings', admin, { hsnMinDigits: 5 })).status).toBe(400);
    await t.ok('PATCH', '/business/settings', admin, { hsnMinDigits: 4 });
  });

  it('keeps the supply type in step when the rate changes', async () => {
    const item = (await newItem({ taxRate: 18 })).body;
    expect((await patchItem(item.id, { taxRate: 0 })).body.supplyType).toBe('NIL_RATED');
    expect((await patchItem(item.id, { supplyType: 'EXEMPT' })).body.supplyType).toBe('EXEMPT');
    expect((await patchItem(item.id, { sellPrice: 120 })).body.supplyType).toBe('EXEMPT'); // still fits 0%
    expect((await patchItem(item.id, { taxRate: 5 })).body.supplyType).toBe('TAXABLE');
    expect((await patchItem(item.id, { supplyType: 'NON_GST' })).status).toBe(400); // rate is 5%
  });

  it('accepts known GST units in any case and rejects others', async () => {
    const item = (await newItem({ uom: 'Tray' })).body;
    expect((await patchItem(item.id, { uqc: 'nos' })).body.uqc).toBe('NOS');
    expect((await patchItem(item.id, { uqc: 'XYZ' })).status).toBe(400);
    expect((await patchItem(item.id, { uqc: null })).body.uqc).toBeNull();
  });
});

describe('sale lines', () => {
  it('keep the GST details the item had when sold', async () => {
    const ctx = await t.branchWithRegister(admin);
    const item = (await newItem({ taxRate: 18, hsnCode: '8517', uom: 'NOS' })).body;
    await t.ok('POST', '/stock/opening', ctx.token, { branchId: ctx.branch.id, itemId: item.id, qty: 5 });
    const { invoice } = await t.ok(
      'POST',
      '/sales/checkout',
      ctx.token,
      checkoutBody(ctx.branch.id, ctx.walkIn.id, [line(item.id, { taxRate: 18 })], [{ mode: 'CASH', amount: 118 }])
    );
    expect(invoice.lines[0]).toMatchObject({ hsnCode: '8517', uqc: 'NOS', supplyType: 'TAXABLE' });

    await patchItem(item.id, { hsnCode: '851712', uqc: 'PCS' });
    const sold = await t.ok('GET', `/sales/${invoice.id}`, ctx.token);
    expect(sold.lines[0]).toMatchObject({ hsnCode: '8517', uqc: 'NOS' });
  });
});
