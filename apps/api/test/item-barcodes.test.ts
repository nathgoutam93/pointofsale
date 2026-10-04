import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from './helpers';

// Items are scanned by their code or any of their barcodes (a box by its own); a barcode belongs
// to one item and is never another item's code. The weighing scale's label layout is a setting.
let t: TestApp;
let admin: string;
let ctx: Awaited<ReturnType<TestApp['branchWithRegister']>>;
beforeAll(async () => {
  t = await startApp();
  admin = await t.login();
  ctx = await t.branchWithRegister(admin);
});
afterAll(async () => {
  await t.call('PATCH', '/business/settings', admin, { scaleBarcode: null });
  await t.close();
});

const unique = () => randomUUID().replace(/\D/g, '').slice(0, 12).padEnd(12, '7');
const newItem = (body: Record<string, unknown>) =>
  t.call('POST', '/items', ctx.token, { code: `B${randomUUID().slice(0, 8)}`, name: `Barcoded ${randomUUID().slice(0, 6)}`, uom: 'PCS', sellPrice: 10, taxRate: 0, ...body });

describe('item barcodes', () => {
  it('saves several barcodes, a box its own, and lists them with the item', async () => {
    const [ean1, ean2, boxCode] = [unique(), unique(), unique()];
    const created = await newItem({
      saleUoms: [{ uom: 'BOX', conversionQty: 12, sellPrice: 110 }],
      barcodes: [{ barcode: ean1 }, { barcode: ean2 }, { barcode: boxCode, saleUom: 'box' }]
    });
    expect(created.status).toBe(201);
    expect(created.body.barcodes.map((row: { barcode: string; saleUom: string | null }) => [row.barcode, row.saleUom])).toEqual([
      [ean1, null],
      [ean2, null],
      [boxCode, 'BOX']
    ]);
    const listed = (await t.ok('GET', '/items', ctx.token)).find((item: { id: string }) => item.id === created.body.id);
    expect(listed.barcodes).toHaveLength(3);

    // Another item can't take one of them, nor use one as its code.
    expect((await newItem({ barcodes: [{ barcode: ean1 }] })).body.message).toMatch(/already on/);
    expect((await newItem({ code: ean2 })).body.message).toMatch(/is a barcode of/);
    // Nor be scanned by another item's code.
    expect((await newItem({ barcodes: [{ barcode: created.body.code }] })).body.message).toMatch(/is the code of/);
    // A unit the item isn't sold in.
    expect((await newItem({ barcodes: [{ barcode: unique(), saleUom: 'CASE' }] })).status).toBe(400);

    // Replacing them; dropping the box drops its barcode.
    const replaced = await t.ok('PATCH', `/items/${created.body.id}`, ctx.token, { barcodes: [{ barcode: ean1 }, { barcode: boxCode, saleUom: 'BOX' }] });
    expect(replaced.barcodes).toHaveLength(2);
    const noBox = await t.ok('PATCH', `/items/${created.body.id}`, ctx.token, { saleUoms: [] });
    expect(noBox.barcodes.map((row: { barcode: string }) => row.barcode)).toEqual([ean1]);
    // Freed barcodes can go on another item.
    expect((await newItem({ barcodes: [{ barcode: ean2 }] })).status).toBe(201);
  });

  it("keeps the weighing scale's label layout", async () => {
    const layout = { prefix: '2', itemDigits: 6, valueType: 'WEIGHT', valueDigits: 5, valueDecimals: 3 };
    expect((await t.ok('PATCH', '/business/settings', admin, { scaleBarcode: layout })).scaleBarcode).toEqual(layout);
    expect((await t.call('PATCH', '/business/settings', admin, { scaleBarcode: { ...layout, itemDigits: 7, valueDigits: 7 } })).status).toBe(400);
    expect((await t.ok('PATCH', '/business/settings', admin, { scaleBarcode: null })).scaleBarcode).toBeNull();
  });
});
