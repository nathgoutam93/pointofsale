import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from './helpers';

// Reorder levels per item at each branch, and the list of what is running low.
let t: TestApp;
let admin: string;
let ctx: Awaited<ReturnType<TestApp['branchWithRegister']>>;
beforeAll(async () => {
  t = await startApp();
  admin = await t.login();
  ctx = await t.branchWithRegister(admin);
});
afterAll(async () => { await t.close(); });

const setLevel = (token: string, body: Record<string, unknown>) => t.call('PUT', '/stock/reorder-level', token, { branchId: ctx.branch.id, reorderQty: null, ...body });
const low = (token: string, branchId = ctx.branch.id) =>
  t.ok<Array<{ itemId: string; onHand: number; reorderLevel: number; reorderQty: number | null }>>('GET', `/stock/low?branchId=${branchId}`, token);

describe('low stock', () => {
  it('lists items at or below their level, furthest below first, and follows sales', async () => {
    const plenty = await t.item(ctx.token, ctx.branch.id, { stock: 50 });
    const atLevel = await t.item(ctx.token, ctx.branch.id, { stock: 5 });
    const empty = await t.item(ctx.token, ctx.branch.id, { stock: 0 });
    const unwatched = await t.item(ctx.token, ctx.branch.id, { stock: 1 });

    expect((await setLevel(ctx.token, { itemId: plenty.id, reorderLevel: 10, reorderQty: 40 })).body).toMatchObject({ onHand: 50, reorderLevel: 10, reorderQty: 40 });
    await setLevel(ctx.token, { itemId: atLevel.id, reorderLevel: 5 });
    // No stock yet: the level still counts, at 0 on hand.
    expect((await setLevel(ctx.token, { itemId: empty.id, reorderLevel: 2, reorderQty: 12 })).status).toBe(200);

    const rows = await low(ctx.token);
    const ours = rows.filter((row) => [plenty.id, atLevel.id, empty.id, unwatched.id].includes(row.itemId));
    expect(ours.map((row) => row.itemId)).toEqual([empty.id, atLevel.id]);
    expect(ours[0]).toMatchObject({ onHand: 0, reorderLevel: 2, reorderQty: 12 });

    // Selling 40 takes the first item to its level.
    await t.ok('POST', '/stock/adjustment', ctx.token, { branchId: ctx.branch.id, itemId: plenty.id, qty: 40, direction: 'OUT', reason: 'Sold elsewhere' });
    expect((await low(ctx.token)).some((row) => row.itemId === plenty.id)).toBe(true);

    // On-hand rows carry the levels; clearing one stops watching it.
    const onHand = await t.ok<Array<{ itemId: string; reorderLevel: number | null }>>('GET', `/stock/on-hand?branchId=${ctx.branch.id}&itemId=${atLevel.id}`, ctx.token);
    expect(onHand[0].reorderLevel).toBe(5);
    await setLevel(ctx.token, { itemId: atLevel.id, reorderLevel: null });
    expect((await low(ctx.token)).some((row) => row.itemId === atLevel.id)).toBe(false);
  });

  it('is per branch, and only stock changers set levels', async () => {
    const item = await t.item(ctx.token, ctx.branch.id, { stock: 3 });
    await setLevel(ctx.token, { itemId: item.id, reorderLevel: 5 });
    const other = await t.newBranch(admin, 'Other');
    expect((await low(admin, other.id)).some((row) => row.itemId === item.id)).toBe(false);

    expect((await setLevel(ctx.token, { itemId: item.id, reorderLevel: null, reorderQty: 5 })).status).toBe(400);
    expect((await setLevel(ctx.token, { itemId: item.id, reorderLevel: -1 })).status).toBe(400);

    const cashier = await t.cashierWithRegister(admin, ctx.branch.id);
    expect((await setLevel(cashier.token, { itemId: item.id, reorderLevel: 1 })).status).toBe(403);
    expect((await low(cashier.token)).some((row) => row.itemId === item.id)).toBe(true);
    const stockKeeper = await t.cashierWithRegister(admin, ctx.branch.id, ['MANAGE_STOCK']);
    expect((await setLevel(stockKeeper.token, { itemId: item.id, reorderLevel: 1 })).status).toBe(200);
  });
});
