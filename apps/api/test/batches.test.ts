import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays } from '../src/suppliers/supplier-ledger';
import { pickBatches, putBack, splitOverShares } from '../src/stock/batches';
import { checkoutBody, line, startApp, type TestApp } from './helpers';

// Items kept by batch: stock comes in by batch with an expiry date, sales take the earliest
// expiry first and never expired stock, and returns, cancellations and transfers move the same
// batches back and forth.
let t: TestApp;
let admin: string;
let ctx: Awaited<ReturnType<TestApp['branchWithRegister']>>;
let today: string;
let itemId: string;

type Batch = { batchNo: string; qty: number; expired: boolean; expiryDate: string | null };
const batches = async (branchId = ctx.branch.id, query = `itemId=${itemId}`) =>
  (await t.ok<Batch[]>('GET', `/stock/batches?branchId=${branchId}&${query}`, admin)).map((row) => [row.batchNo, row.qty, row.expired]);

beforeAll(async () => {
  t = await startApp();
  admin = await t.login();
  ctx = await t.branchWithRegister(admin);
  const timeZone = (await t.ok('GET', '/business/settings', admin)).timezone;
  today = new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
  itemId = (await t.ok('POST', '/items', admin, { code: `MED${randomUUID().slice(0, 6)}`, name: 'Paracetamol 500', uom: 'PCS', sellPrice: 10, taxRate: 0, tracksBatches: true })).id;
});
afterAll(async () => { await t.close(); });

const opening = (batchNo: string | undefined, qty: number, expiryDate?: string) =>
  t.call('POST', '/stock/opening', admin, { branchId: ctx.branch.id, itemId, qty, batchNo, expiryDate });
const sell = (qty: number) => t.call('POST', '/sales/checkout', ctx.token, checkoutBody(ctx.branch.id, ctx.walkIn.id, [line(itemId, { qty, rate: 10 })], [{ mode: 'CASH', amount: qty * 10 }]));

describe('batches and expiry', () => {
  it('come in by batch, one opening count per batch', async () => {
    expect((await opening(undefined, 5)).status).toBe(400);
    expect((await opening('a-1', 5, addDays(today, 10))).status).toBe(201);
    expect((await opening('B-2', 5, addDays(today, 100))).status).toBe(201);
    expect((await opening('C-3', 3, addDays(today, -1))).status).toBe(201);
    expect((await opening('A-1', 1, addDays(today, 10))).status).toBe(400); // already counted
    // A batch keeps its expiry date.
    const clash = await t.call('POST', '/stock/adjustment', admin, { branchId: ctx.branch.id, itemId, qty: 1, direction: 'IN', reason: 'Found', batchNo: 'A-1', expiryDate: addDays(today, 11) });
    expect(clash.status).toBe(400);
    expect(await batches()).toEqual([['C-3', 3, true], ['A-1', 5, false], ['B-2', 5, false]]);
  });

  it('sell the earliest expiry first, never expired stock, and print the batches on the bill', async () => {
    const sale = await sell(7);
    expect(sale.status).toBe(200);
    expect(await batches()).toEqual([['C-3', 3, true], ['B-2', 3, false]]);
    const detail = await t.ok('GET', `/sales/${sale.body.invoice.id}`, ctx.token);
    expect(detail.lines[0].batches).toEqual([
      { batchNo: 'A-1', expiryDate: addDays(today, 10), qty: 5 },
      { batchNo: 'B-2', expiryDate: addDays(today, 100), qty: 2 }
    ]);

    // 6 left in all, but 3 of it expired.
    const refused = await sell(4);
    expect(refused.status).toBe(400);
    expect(refused.body.message).toMatch(/only 3 can be sold; 3 more is expired stock \(batch C-3/);

    // Back into the batches it left: A first.
    const returned = await t.call('POST', `/sales/${sale.body.invoice.id}/return`, ctx.token, { lines: [{ saleLineId: detail.lines[0].id, qty: 6 }], refundMode: 'CASH', reason: 'Wrong strength' });
    expect(returned.status).toBe(201);
    expect(await batches()).toEqual([['C-3', 3, true], ['A-1', 5, false], ['B-2', 4, false]]);
    // The last one goes back into B.
    await t.ok('POST', `/sales/${sale.body.invoice.id}/return`, ctx.token, { lines: [{ saleLineId: detail.lines[0].id, qty: 1 }], refundMode: 'CASH', reason: 'Wrong strength' });
    expect(await batches()).toEqual([['C-3', 3, true], ['A-1', 5, false], ['B-2', 5, false]]);
  });

  it('put a cancelled bill back into its batches', async () => {
    const draft = await t.ok('POST', '/sales', ctx.token, { branchId: ctx.branch.id, customerId: ctx.walkIn.id, lines: [line(itemId, { qty: 6, rate: 10 })] });
    expect(await batches()).toEqual([['C-3', 3, true], ['B-2', 4, false]]);
    await t.ok('POST', `/sales/${draft.id}/cancel`, ctx.token, { reason: 'Customer left' });
    expect(await batches()).toEqual([['C-3', 3, true], ['A-1', 5, false], ['B-2', 5, false]]);
  });

  it('keeps expired stock blocked when an admin may sell below zero', async () => {
    const previous = await t.db.businessSettings.findUniqueOrThrow({ where: { id: 'default' } });
    await t.db.businessSettings.update({ where: { id: 'default' }, data: { allowNegativeStock: true } });
    const before = await batches();
    try {
      const rejected = await sell(11); // 10 fresh and 3 expired; total stock covers the request.
      expect(rejected.status).toBe(400);
      expect(rejected.body.message).toMatch(/expired stock/);
      expect(await batches()).toEqual(before);
      const asMuchAsExpired = await sell(13); // 3 short: could all be the expired goods.
      expect(asMuchAsExpired.status).toBe(400);
      expect(asMuchAsExpired.body.message).toMatch(/expired stock/);
      expect(await batches()).toEqual(before);
      // 10 short, far more than is expired: the count missed goods. The fresh batches give what
      // they have, the rest goes without a batch, and the expired batch is left to write off.
      const pastStock = await sell(20);
      expect(pastStock.status).toBe(200);
      expect(await batches()).toEqual(before.filter(([, , expired]) => expired));
      await t.ok('POST', `/sales/${pastStock.body.invoice.id}/return`, ctx.token, {
        refundMode: 'CASH', reason: 'Undo the past-stock sale', lines: pastStock.body.invoice.lines.map((line: { id: string; qty: string }) => ({ saleLineId: line.id, qty: Number(line.qty) }))
      });
      expect(await batches()).toEqual(before);
    } finally {
      await t.db.businessSettings.update({ where: { id: 'default' }, data: { allowNegativeStock: previous.allowNegativeStock } });
    }
  });

  it('send the earliest expiry to another branch, in the same batches', async () => {
    const other = await t.branchWithRegister(admin);
    const sent = await t.ok('POST', '/stock-transfers', admin, { fromBranchId: ctx.branch.id, toBranchId: other.branch.id, lines: [{ itemId, qty: 7 }] });
    expect(await batches()).toEqual([['C-3', 3, true], ['B-2', 3, false]]);
    await t.ok('POST', `/stock-transfers/${sent.id}/receive`, admin);
    expect(await batches(other.branch.id)).toEqual([['A-1', 5, false], ['B-2', 2, false]]);
    const back = await t.ok('POST', '/stock-transfers', admin, { fromBranchId: other.branch.id, toBranchId: ctx.branch.id, lines: [{ itemId, qty: 7 }] });
    await t.ok('POST', `/stock-transfers/${back.id}/cancel`, admin);
    expect(await batches(other.branch.id)).toEqual([['A-1', 5, false], ['B-2', 2, false]]);
  });

  it('write expired stock off by batch, and list what expires soon', async () => {
    const soon = await batches(ctx.branch.id, 'expiringWithinDays=30');
    expect(soon).toEqual([['C-3', 3, true]]);
    expect((await t.call('POST', '/stock/adjustment', admin, { branchId: ctx.branch.id, itemId, qty: 4, direction: 'OUT', reason: 'Expired', batchNo: 'C-3' })).status).toBe(400);
    await t.ok('POST', '/stock/adjustment', admin, { branchId: ctx.branch.id, itemId, qty: 3, direction: 'OUT', reason: 'Expired', batchNo: 'c-3' });
    expect(await batches()).toEqual([['B-2', 3, false]]);
  });

  it('come in on purchases, each batch once, and go back to the supplier from their batch', async () => {
    const buy = (lines: unknown[]) => t.call('POST', '/purchases', admin, { branchId: ctx.branch.id, supplierName: 'Pharma Distributors', lines });
    expect((await buy([{ itemId, qty: 10, unitCost: 5 }])).status).toBe(400); // no batch
    expect((await buy([{ itemId, qty: 1, unitCost: 5, batchNo: 'D-4' }, { itemId, qty: 1, unitCost: 5, batchNo: 'd-4' }])).status).toBe(400);
    const purchase = await buy([
      { itemId, qty: 10, unitCost: 5, batchNo: 'D-4', expiryDate: addDays(today, 20) },
      { itemId, qty: 10, unitCost: 7, batchNo: 'E-5', expiryDate: addDays(today, 200) }
    ]);
    expect(purchase.status).toBe(201);
    expect(purchase.body.lines.map((row: { batch: { batchNo: string } }) => row.batch.batchNo).sort()).toEqual(['D-4', 'E-5']);
    // The cost is what was paid; of two batches at two costs, the line entered last.
    expect(Number((await t.db.item.findUniqueOrThrow({ where: { id: itemId } })).costPrice)).toBe(7);
    expect(await batches()).toEqual([['D-4', 10, false], ['B-2', 3, false], ['E-5', 10, false]]);

    const eLine = purchase.body.lines.find((row: { batch: { batchNo: string } }) => row.batch.batchNo === 'E-5');
    await t.ok('POST', `/purchases/${purchase.body.id}/returns`, admin, { lines: [{ purchaseLineId: eLine.id, qty: 4 }], reason: 'Short dated' });
    expect(await batches()).toEqual([['D-4', 10, false], ['B-2', 3, false], ['E-5', 6, false]]);
  });
});

describe('batch helpers', () => {
  const lot = (batchId: string, expiryDate: string | null, qty: number, day = 1) => ({ batchId, batchNo: batchId, expiryDate, createdAt: new Date(Date.UTC(2026, 0, day)), qty });

  it('take stock without a batch first, then by expiry, skipping expired', () => {
    const lots = [lot('LATE', '2027-01-01', 5), lot('NONE', null, 5), lot('SOON', '2026-02-01', 2), lot('OLD', '2026-01-01', 9)];
    expect(pickBatches({ lots, unbatched: 1, qty: 9, today: '2026-01-15' })).toEqual({
      taken: [{ batchId: null, qty: 1 }, { batchId: 'SOON', qty: 2 }, { batchId: 'LATE', qty: 5 }, { batchId: 'NONE', qty: 1 }],
      short: 0,
      expired: 9
    });
    expect(pickBatches({ lots, unbatched: 0, qty: 20, today: '2026-01-15', includeExpired: true }).taken.at(-1)).toEqual({ batchId: 'OLD', qty: 8 });
  });

  it('split lines over the shares in order, and put goods back where they came from', () => {
    const parts = splitOverShares([{ itemId: 'I', qty: 3 }, { itemId: 'I', qty: 4 }, { itemId: 'J', qty: 1 }], new Map([['I', [{ batchId: 'A', qty: 5 }, { batchId: 'B', qty: 2 }]]]));
    expect(parts.map((part) => [part.line.qty, part.batchId, part.qty])).toEqual([[3, 'A', 3], [4, 'A', 2], [4, 'B', 2], [1, null, 1]]);
    expect(putBack([{ batchId: 'A', qty: 5 }, { batchId: 'B', qty: 2 }], [{ batchId: 'A', qty: 4 }], 3)).toEqual([{ batchId: 'A', qty: 1 }, { batchId: 'B', qty: 2 }]);
    expect(putBack([{ batchId: 'A', qty: 1 }], [], 2)).toEqual([{ batchId: 'A', qty: 1 }, { batchId: null, qty: 1 }]);
  });
});
