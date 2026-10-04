import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from './helpers';

// Stock moved between branches: out of the source when sent, into the destination when received.
let t: TestApp;
let admin: string;
let from: Awaited<ReturnType<TestApp['branchWithRegister']>>;
let to: { id: string; code: string };
beforeAll(async () => {
  t = await startApp();
  admin = await t.login();
  from = await t.branchWithRegister(admin);
  to = await t.newBranch(admin, 'Dest');
});
afterAll(async () => { await t.close(); });

const send = (lines: unknown[], toBranchId = to.id) =>
  t.call('POST', '/stock-transfers', admin, { fromBranchId: from.branch.id, toBranchId, lines });
const stockAt = async (branchId: string, itemId: string) =>
  Number((await t.db.itemStock.findUnique({ where: { branchId_itemId: { branchId, itemId } } }))?.qty ?? 0);

describe('stock transfers', () => {
  it('takes stock out when sent and puts it in when received', async () => {
    const item = await t.item(from.token, from.branch.id, { stock: 10, costPrice: 7 });
    const sent = await send([{ itemId: item.id, qty: 4 }]);
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ transferNo: `TRF-${from.branch.code}-000001`, status: 'IN_TRANSIT' });
    expect(Number(sent.body.lines[0].unitCost)).toBe(7);
    expect(await stockAt(from.branch.id, item.id)).toBe(6);
    expect(await stockAt(to.id, item.id)).toBe(0);

    const received = await t.call('POST', `/stock-transfers/${sent.body.id}/receive`, admin);
    expect(received.status).toBe(200);
    expect(received.body).toMatchObject({ status: 'RECEIVED', closedByName: 'admin' });
    expect(await stockAt(to.id, item.id)).toBe(4);
    // Once received it can't be received again or called back.
    expect((await t.call('POST', `/stock-transfers/${sent.body.id}/receive`, admin)).status).toBe(400);
    expect((await t.call('POST', `/stock-transfers/${sent.body.id}/cancel`, admin)).status).toBe(400);
    expect(await stockAt(to.id, item.id)).toBe(4);

    // Both branches see it.
    for (const branchId of [from.branch.id, to.id]) {
      const list = await t.ok<Array<{ id: string }>>('GET', `/stock-transfers?branchId=${branchId}`, admin);
      expect(list.map((row) => row.id)).toContain(sent.body.id);
    }
  });

  it('returns the stock to the source when cancelled in transit', async () => {
    const item = await t.item(from.token, from.branch.id, { stock: 5 });
    const sent = await send([{ itemId: item.id, qty: 5 }]);
    expect(await stockAt(from.branch.id, item.id)).toBe(0);
    const cancelled = await t.ok('POST', `/stock-transfers/${sent.body.id}/cancel`, admin);
    expect(cancelled.status).toBe('CANCELLED');
    expect(await stockAt(from.branch.id, item.id)).toBe(5);
    expect(await stockAt(to.id, item.id)).toBe(0);
  });

  it('receives or cancels only once when both happen at the same moment', async () => {
    const item = await t.item(from.token, from.branch.id, { stock: 3 });
    const sent = await send([{ itemId: item.id, qty: 3 }]);
    const results = await Promise.all([
      t.call('POST', `/stock-transfers/${sent.body.id}/receive`, admin),
      t.call('POST', `/stock-transfers/${sent.body.id}/cancel`, admin),
      t.call('POST', `/stock-transfers/${sent.body.id}/receive`, admin)
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect((await stockAt(from.branch.id, item.id)) + (await stockAt(to.id, item.id))).toBe(3);
  });

  it('never sends more than is on hand, even when sent twice at once', async () => {
    const item = await t.item(from.token, from.branch.id, { stock: 3 });
    expect((await send([{ itemId: item.id, qty: 4 }])).body.message).toMatch(/3 on hand, 4 to send/);
    const results = await Promise.all([1, 2].map(() => send([{ itemId: item.id, qty: 2 }])));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await stockAt(from.branch.id, item.id)).toBe(1);
  });

  it('rejects sending to the same branch, duplicate items, and users without access', async () => {
    const item = await t.item(from.token, from.branch.id, { stock: 5 });
    expect((await send([{ itemId: item.id, qty: 1 }], from.branch.id)).status).toBe(400);
    expect((await send([{ itemId: item.id, qty: 1 }, { itemId: item.id, qty: 1 }])).status).toBe(400);

    const username = `till-${randomUUID().slice(0, 8)}`;
    await t.ok('POST', '/users', admin, { branchId: from.branch.id, username, password: 'cashier-pass-1' });
    const cashier = await t.login(username, 'cashier-pass-1');
    expect((await t.call('POST', '/stock-transfers', cashier, { fromBranchId: from.branch.id, toBranchId: to.id, lines: [{ itemId: item.id, qty: 1 }] })).status).toBe(400);
    // A cashier at the source branch can't list the destination's transfers.
    expect((await t.call('GET', `/stock-transfers?branchId=${to.id}`, cashier)).status).toBe(400);
    expect(await stockAt(from.branch.id, item.id)).toBe(5);
    // Nor see where to send to.
    expect((await t.call('GET', '/stock-transfers/destinations', cashier)).status).toBe(400);
  });

  it('lets a cashier allowed to send pick any branch, not only the ones they work at', async () => {
    const { token: cashier } = await t.cashierWithRegister(admin, from.branch.id, ['SEND_TRANSFERS']);
    const destinations = await t.ok<Array<{ id: string }>>('GET', '/stock-transfers/destinations', cashier);
    expect(destinations.map((branch) => branch.id)).toEqual(expect.arrayContaining([from.branch.id, to.id]));
    expect(destinations).toHaveLength(await t.db.branch.count());

    const item = await t.item(from.token, from.branch.id, { stock: 5 });
    const sent = await t.call('POST', '/stock-transfers', cashier, { fromBranchId: from.branch.id, toBranchId: to.id, lines: [{ itemId: item.id, qty: 2 }] });
    expect(sent.status).toBe(201);
    expect(await stockAt(from.branch.id, item.id)).toBe(3);
  });
});
