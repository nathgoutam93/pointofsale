import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from './helpers';

// Items from a spreadsheet: checked row by row, then all saved or none.
let t: TestApp;
let admin: string;
let ctx: Awaited<ReturnType<TestApp['branchWithRegister']>>;
beforeAll(async () => {
  t = await startApp();
  admin = await t.login();
  ctx = await t.branchWithRegister(admin);
});
afterAll(async () => { await t.close(); });

type Result = { applied: boolean; created: number; updated: number; errors: Array<{ row: number; message: string }>; warnings: Array<{ row: number; message: string }> };
const tag = () => randomUUID().slice(0, 6).toUpperCase();
const send = (token: string, rows: Array<Record<string, unknown>>, dryRun = false) =>
  t.call('POST', '/items/import', token, { branchId: ctx.branch.id, dryRun, rows: rows.map((row, index) => ({ row: index + 2, ...row })) });

describe('item import', () => {
  it('adds new items with stock, barcodes and reorder levels, and updates those already there', async () => {
    const existing = await t.item(ctx.token, ctx.branch.id, { sellPrice: 40, stock: 5 });
    const soap = `SOAP${tag()}`;
    const rice = `RICE${tag()}`;
    const barcode = `890${Date.now()}`.slice(0, 13);
    const rows = [
      { code: soap, name: 'Neem Soap', unit: 'PCS', sellPrice: '₹45.00', mrp: '50', costPrice: '30', gstRate: '18%', hsnCode: '3401', barcodes: barcode, openingStock: '24', reorderLevel: '6', reorderQty: '48' },
      { code: rice, name: 'Sona Rice 5 kg', unit: 'BAG', sellPrice: '1,250', gstRate: '5', priceIncludesGst: 'No', tracksBatches: 'yes', openingStock: '10', batchNo: 'r-01', expiryDate: '2027-01-31' },
      { code: existing.code.toLowerCase(), sellPrice: '42', name: '' }
    ];
    const check = await send(ctx.token, rows, true);
    expect(check.body).toMatchObject({ applied: false, created: 2, updated: 1, errors: [] });
    expect(await t.db.item.count({ where: { code: soap } })).toBe(0);

    const done = (await send(ctx.token, rows)).body as Result;
    expect(done).toMatchObject({ applied: true, created: 2, updated: 1, errors: [] });
    const saved = await t.db.item.findUniqueOrThrow({ where: { code: soap }, include: { barcodes: true } });
    expect(saved).toMatchObject({ name: 'Neem Soap', taxMode: 'INCLUSIVE', hsnCode: '3401' });
    expect(Number(saved.sellPrice)).toBe(45);
    expect(Number(saved.costPrice)).toBe(30);
    expect(saved.barcodes.map((row) => row.barcode)).toEqual([barcode]);
    expect(await t.onHand(ctx.token, ctx.branch.id, saved.id)).toBe(24);
    expect(Number((await t.db.itemStock.findUniqueOrThrow({ where: { branchId_itemId: { branchId: ctx.branch.id, itemId: saved.id } } })).reorderLevel)).toBe(6);

    const bag = await t.db.item.findUniqueOrThrow({ where: { code: rice } });
    expect(bag).toMatchObject({ taxMode: 'EXCLUSIVE', tracksBatches: true });
    const batch = await t.db.batchStock.findFirstOrThrow({ where: { batch: { itemId: bag.id } }, include: { batch: true } });
    expect(batch.batch).toMatchObject({ batchNo: 'R-01', expiryDate: '2027-01-31' });
    expect(Number(batch.qty)).toBe(10);

    // The item already there kept its name and took the new price, but no stock.
    const after = await t.db.item.findUniqueOrThrow({ where: { id: existing.id } });
    expect(Number(after.sellPrice)).toBe(42);
    expect(after.name).not.toBe('');
    expect(await t.onHand(ctx.token, ctx.branch.id, existing.id)).toBe(5);
    expect(await t.db.auditEvent.count({ where: { action: 'ITEMS_IMPORTED' } })).toBe(1);
  });

  it('reports every bad row and saves nothing', async () => {
    const taken = await t.item(ctx.token, ctx.branch.id, { stock: 0 });
    const a = `A${tag()}`;
    const rows = [
      { code: a, name: 'Fine', unit: 'PCS', sellPrice: '10', gstRate: '0' },
      { code: a, name: 'Twice', unit: 'PCS', sellPrice: '10', gstRate: '0' },
      { code: `B${tag()}`, name: 'No price', unit: 'PCS', gstRate: '5' },
      { code: `C${tag()}`, name: 'Bad number', unit: 'PCS', sellPrice: 'ten', gstRate: '5' },
      { code: `D${tag()}`, name: 'Above MRP', unit: 'PCS', sellPrice: '120', mrp: '100', gstRate: '0' },
      { code: `E${tag()}`, name: 'Batch needed', unit: 'PCS', sellPrice: '10', gstRate: '0', tracksBatches: 'Yes', openingStock: '5' },
      { code: `F${tag()}`, name: 'Taken barcode', unit: 'PCS', sellPrice: '10', gstRate: '0', barcodes: taken.code },
      { code: `G${tag()}`, name: 'Half a piece', unit: 'PCS', sellPrice: '10', gstRate: '0', openingStock: '1.5' },
      { code: '' }
    ];
    const res = (await send(ctx.token, rows)).body as Result;
    expect(res.applied).toBe(false);
    expect(res.errors.map((error) => error.row)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    expect(res.errors.find((error) => error.row === 4)?.message).toMatch(/Selling price is needed/);
    expect(res.errors.find((error) => error.row === 5)?.message).toMatch(/"ten" isn't a number/);
    expect(res.errors.find((error) => error.row === 6)?.message).toMatch(/MRP/);
    expect(res.errors.find((error) => error.row === 7)?.message).toMatch(/batch/);
    expect(res.errors.find((error) => error.row === 8)?.message).toMatch(/is the code of/);
    expect(await t.db.item.count({ where: { code: a } })).toBe(0);
  });

  it('groups variants under their product', async () => {
    const product = `Cotton Tee ${tag()}`;
    const rows = ['S', 'M'].flatMap((size) =>
      ['Black', 'White'].map((colour) => ({ code: `TEE-${tag()}`, name: `Tee ${size} ${colour}`, unit: 'PCS', sellPrice: '299', gstRate: '5', product, size, colour }))
    );
    expect((await send(ctx.token, rows)).body).toMatchObject({ applied: true, created: 4 });
    const groups = await t.ok<Array<{ name: string; option2Name: string | null; option1Values: string[]; items: unknown[] }>>('GET', '/item-groups', ctx.token);
    expect(groups.find((group) => group.name === product)).toMatchObject({ option2Name: 'Colour', option1Values: ['S', 'M'], items: expect.any(Array) });
    expect(groups.find((group) => group.name === product)?.items).toHaveLength(4);

    const more = await send(ctx.token, [
      { code: `TEE-${tag()}`, name: 'Tee L Black', unit: 'PCS', sellPrice: '299', gstRate: '5', product, size: 'L', colour: 'Black' },
      { code: `TEE-${tag()}`, name: 'Tee S Black again', unit: 'PCS', sellPrice: '299', gstRate: '5', product, size: 's', colour: 'black' },
      { code: `TEE-${tag()}`, name: 'Tee no colour', unit: 'PCS', sellPrice: '299', gstRate: '5', product, size: 'XL' }
    ]);
    expect((more.body as Result).errors.map((error) => error.row)).toEqual([3, 4]);
  });

  it('is for item managers; stock and costs need their own rights', async () => {
    const row = { code: `P${tag()}`, name: 'Pen', unit: 'PCS', sellPrice: '10', gstRate: '18', costPrice: '6', openingStock: '5' };
    const cashier = await t.cashierWithRegister(admin, ctx.branch.id);
    expect((await send(cashier.token, [row])).status).toBe(403);
    const itemsOnly = await t.cashierWithRegister(admin, ctx.branch.id, ['MANAGE_ITEMS']);
    const res = (await send(itemsOnly.token, [row])).body as Result;
    expect(res.errors[0].message).toMatch(/permission to adjust stock/);
    expect(res.warnings[0].message).toMatch(/Cost price left out/);
    const done = (await send(itemsOnly.token, [{ ...row, openingStock: '' }])).body as Result;
    expect(done.applied).toBe(true);
    expect(Number((await t.db.item.findUniqueOrThrow({ where: { code: row.code } })).costPrice)).toBe(0);
  });
});
