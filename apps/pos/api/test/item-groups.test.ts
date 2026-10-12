import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from './helpers';

// Products in sizes and colours: each combination an item of its own, grouped under the product.
let t: TestApp;
let admin: string;
let ctx: Awaited<ReturnType<TestApp['branchWithRegister']>>;
beforeAll(async () => {
  t = await startApp();
  admin = await t.login();
  ctx = await t.branchWithRegister(admin);
});
afterAll(async () => { await t.close(); });

type Group = { id: string; name: string; items: Array<{ id: string; code: string; name: string; option1: string; option2: string | null; sellPrice: number }> };
const unique = () => randomUUID().slice(0, 6).toUpperCase();
const product = (body: Record<string, unknown> = {}) =>
  t.call('POST', '/item-groups', ctx.token, {
    name: `Polo Shirt ${unique()}`,
    codePrefix: `POLO${unique()}`,
    uom: 'PCS',
    option1Name: 'Size',
    option1Values: ['S', 'M', 'L'],
    option2Name: 'Colour',
    option2Values: ['Red', 'Navy Blue'],
    sellPrice: 499,
    mrp: 599,
    taxMode: 'INCLUSIVE',
    taxRate: 5,
    ...body
  });

describe('products with variants', () => {
  it('makes an item for every size and colour, coded and named by them', async () => {
    const prefix = `POLO${unique()}`;
    const res = await product({ name: 'Classic Polo', codePrefix: prefix });
    expect(res.status).toBe(201);
    const group = res.body as Group;
    expect(group.items).toHaveLength(6);
    // In the order given: sizes, then colours within each.
    expect(group.items.map((item) => `${item.option1} ${item.option2}`)).toEqual(['S Red', 'S Navy Blue', 'M Red', 'M Navy Blue', 'L Red', 'L Navy Blue']);
    expect(group.items.map((item) => item.code)).toContain(`${prefix}-M-NAVYBLUE`);
    expect(group.items.find((item) => item.code === `${prefix}-M-NAVYBLUE`)).toMatchObject({ name: 'Classic Polo M / Navy Blue', option1: 'M', option2: 'Navy Blue', sellPrice: 499 });

    // They are ordinary items: in the list with their product, stocked and sold one by one.
    const items = await t.ok<Array<{ id: string; groupId: string | null; option1: string | null; group: { name: string; option2Name: string | null } | null }>>('GET', '/items', ctx.token);
    const red = items.find((item) => item.id === group.items[0].id)!;
    expect(red).toMatchObject({ groupId: group.id, option1: 'S', group: { name: 'Classic Polo', option2Name: 'Colour' } });
    await t.ok('POST', '/stock/opening', ctx.token, { branchId: ctx.branch.id, itemId: red.id, qty: 4 });
    expect(await t.onHand(ctx.token, ctx.branch.id, red.id)).toBe(4);

    const list = await t.ok<Group[]>('GET', '/item-groups', ctx.token);
    expect(list.find((entry) => entry.id === group.id)?.items).toHaveLength(6);
  });

  it('adds sizes and colours later, copying the first variant', async () => {
    const prefix = `TEE${unique()}`;
    const group = (await product({ codePrefix: prefix })).body as Group;
    const more = await t.call('POST', `/item-groups/${group.id}/values`, ctx.token, { option1Values: ['XL'], option2Values: ['White'] });
    expect(more.status).toBe(200);
    // 4 sizes × 3 colours.
    expect((more.body as Group).items).toHaveLength(12);
    expect((more.body as Group).items.slice(-3).map((item) => item.code)).toEqual([`${prefix}-XL-RED`, `${prefix}-XL-NAVYBLUE`, `${prefix}-XL-WHITE`]);
    expect((more.body as Group).items.map((item) => item.code)).toEqual(expect.arrayContaining([`${prefix}-XL-RED`, `${prefix}-S-WHITE`, `${prefix}-XL-WHITE`]));
    expect((await t.call('POST', `/item-groups/${group.id}/values`, ctx.token, { option1Values: ['m'] })).body.message).toMatch(/already has Size m/);

    const single = (await product({ codePrefix: `CAP${unique()}`, option2Name: undefined, option2Values: undefined, option1Values: ['Free size'] })).body as Group;
    expect(single.items[0].code).toMatch(/-FREESIZE$/);
    expect((await t.call('POST', `/item-groups/${single.id}/values`, ctx.token, { option2Values: ['Red'] })).status).toBe(400);
  });

  it('refuses taken names and codes, and values that code the same', async () => {
    const name = `Kurta ${unique()}`;
    const prefix = `KUR${unique()}`;
    expect((await product({ name, codePrefix: prefix })).status).toBe(201);
    expect((await product({ name: name.toLowerCase() })).body.message).toMatch(/already a product named/);
    expect((await product({ codePrefix: prefix })).body.message).toMatch(/is already/);
    expect((await product({ option1Values: ['X L', 'XL'] })).body.message).toMatch(/same item code/);
    expect((await product({ option1Values: ['S', 's'] })).status).toBe(400);
    expect((await product({ option2Name: 'Colour', option2Values: undefined })).status).toBe(400);
  });

  it('prices every variant at once, within their MRP', async () => {
    const group = (await product()).body as Group;
    expect((await t.call('PATCH', `/item-groups/${group.id}/prices`, ctx.token, { sellPrice: 650 })).status).toBe(400);
    const priced = await t.ok<Group>('PATCH', `/item-groups/${group.id}/prices`, ctx.token, { sellPrice: 699, mrp: 799 });
    expect(new Set(priced.items.map((item) => item.sellPrice))).toEqual(new Set([699]));
  });

  it('is for item managers', async () => {
    const cashier = await t.cashierWithRegister(admin, ctx.branch.id);
    expect((await t.call('POST', '/item-groups', cashier.token, { name: 'X', codePrefix: 'X', uom: 'PCS', option1Name: 'Size', option1Values: ['S'], sellPrice: 1, taxRate: 0 })).status).toBe(403);
    expect((await t.call('GET', '/item-groups', cashier.token)).status).toBe(200);
  });
});
