import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from './helpers';

// An item's category is free text; the ones in use are suggested, and one typed in another
// letter case is saved as the spelling already in use.
let t: TestApp;
let admin: string;
beforeAll(async () => {
  t = await startApp();
  admin = await t.login();
});
afterAll(() => t.close());

const newItem = (category?: string) =>
  t.ok('POST', '/items', admin, { code: `C${randomUUID().slice(0, 8)}`, name: `Categorised ${randomUUID().slice(0, 6)}`, uom: 'PCS', sellPrice: 10, taxRate: 0, ...(category === undefined ? {} : { category }) });

describe('item categories', () => {
  it("lists categories once each, inactive items' too, and saves another case as the existing spelling", async () => {
    const tag = randomUUID().slice(0, 6);
    const snacks = `Snacks ${tag}`;
    const dairy = `Dairy ${tag}`;
    await newItem(snacks);
    expect((await newItem(`  ${snacks.toUpperCase()} `)).category).toBe(snacks);
    expect((await newItem('   ')).category).toBeNull();
    const retired = await newItem(dairy);
    await t.ok('PATCH', `/items/${retired.id}`, admin, { isActive: false });

    const categories: string[] = await t.ok('GET', '/items/categories', admin);
    expect(categories.filter((category) => category.endsWith(tag))).toEqual([dairy, snacks]);
    expect(categories).not.toContain('');

    // An edit snaps to the spelling other items use, but an item alone in its category can respell it.
    const edited = await newItem();
    expect((await t.ok('PATCH', `/items/${edited.id}`, admin, { category: dairy.toLowerCase() })).category).toBe(dairy);
    const loner = await newItem(`odd ${tag}`);
    expect((await t.ok('PATCH', `/items/${loner.id}`, admin, { category: `Odd ${tag}` })).category).toBe(`Odd ${tag}`);
    expect((await t.ok('PATCH', `/items/${loner.id}`, admin, { category: null })).category).toBeNull();
  });

  it('needs a signed-in user', async () => {
    expect((await t.call('GET', '/items/categories', '')).status).toBe(401);
  });
});
