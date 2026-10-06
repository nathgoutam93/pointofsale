import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gstinCheckCharacter } from '@pos/contracts';
import { checkoutBody, line, startApp, type TestApp } from './helpers';

// GST #31: each branch's GSTIN and state, and each sale's seller and place of supply.
let t: TestApp;
let admin: string;
let originalBusinessGstin: string | null;

/** A made-up GSTIN for `state` with a valid check character. */
const gstin = (state: string, pan = 'ABCDE1234F') => {
  const first14 = `${state}${pan}1Z`;
  return first14 + gstinCheckCharacter(first14);
};
const KA = gstin('29');
const KA_OTHER = gstin('29', 'PQRSX5678K');
const MH = gstin('27');
const BUSINESS = gstin('29', 'BUSIN9999B');

const patchBranch = (branchId: string, body: unknown) => t.call('PATCH', `/branches/${branchId}`, admin, body);
const setBusinessGstin = (gstNumber: string | null) => t.ok('PATCH', '/business/settings', admin, { gstNumber });

async function shop() {
  const ctx = await t.branchWithRegister(admin);
  const item = await t.item(ctx.token, ctx.branch.id, { sellPrice: 100 });
  const sell = (extra: Record<string, unknown> = {}) =>
    t.call('POST', '/sales/checkout', ctx.token, checkoutBody(ctx.branch.id, ctx.walkIn.id, [line(item.id)], [{ mode: 'CASH', amount: 100 }], extra));
  return { ...ctx, sell };
}

beforeAll(async () => {
  t = await startApp();
  admin = await t.login();
  await t.db.taxpayerTypeChange.deleteMany({});
  originalBusinessGstin = (await t.ok('GET', '/business/settings', admin)).gstNumber;
  await setBusinessGstin(null);
});
afterAll(async () => {
  await t.db.taxpayerTypeChange.deleteMany({});
  await setBusinessGstin(originalBusinessGstin);
  await t.close();
});

describe('branch GSTIN and state', () => {
  it('rejects GSTINs with a typo, the wrong shape or an unknown state', async () => {
    const { branch } = await shop();
    const typo = await patchBranch(branch.id, { gstin: KA.slice(0, 14) + (KA[14] === 'A' ? 'B' : 'A') });
    expect(typo.status).toBe(400);
    expect(String(typo.body.message)).toMatch(/check character/);
    expect((await patchBranch(branch.id, { gstin: '29ABCDE1234F1Z' })).status).toBe(400);
    expect((await patchBranch(branch.id, { stateCode: '25' })).status).toBe(400);
  });

  it('takes the state from the GSTIN, upper-casing it', async () => {
    const { branch } = await shop();
    const res = await patchBranch(branch.id, { gstin: ` ${KA.toLowerCase()} ` });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ gstin: KA, stateCode: '29' });
  });

  it("won't move a branch with a GSTIN to another state, unless the GSTIN changes too", async () => {
    const { branch } = await shop();
    await t.ok('PATCH', `/branches/${branch.id}`, admin, { gstin: KA });
    const moved = await patchBranch(branch.id, { stateCode: '27' });
    expect(moved.status).toBe(400);
    expect(String(moved.body.message)).toMatch(/29 - Karnataka/);
    expect((await patchBranch(branch.id, { gstin: MH, stateCode: '29' })).status).toBe(400);
    expect((await patchBranch(branch.id, { gstin: MH })).body).toMatchObject({ gstin: MH, stateCode: '27' });
    expect((await patchBranch(branch.id, { gstin: null, stateCode: '29' })).body).toMatchObject({ gstin: null, stateCode: '29' });
  });

  it('checks the business GSTIN too', async () => {
    expect((await t.call('PATCH', '/business/settings', admin, { gstNumber: '29ABCDE1234F1ZZ' })).status).toBe(400);
  });
});

describe('seller and place of supply on each sale', () => {
  it('records a counter sale as made in the branch state under its GSTIN', async () => {
    const s = await shop();
    await t.ok('PATCH', `/branches/${s.branch.id}`, admin, { gstin: KA });
    const res = await s.sell();
    expect(res.status).toBe(200);
    expect(res.body.invoice).toMatchObject({ sellerGstin: KA, sellerStateCode: '29', placeOfSupplyStateCode: '29' });
  });

  it('records goods shipped to another state', async () => {
    const s = await shop();
    await t.ok('PATCH', `/branches/${s.branch.id}`, admin, { gstin: KA });
    const res = await s.sell({ placeOfSupplyStateCode: '27' });
    expect(res.status).toBe(200);
    expect(res.body.invoice).toMatchObject({ sellerStateCode: '29', placeOfSupplyStateCode: '27' });
    expect((await s.sell({ placeOfSupplyStateCode: '28' })).status).toBe(400); // retired code
  });

  it('requires seller registration before billing as a registered shop', async () => {
    const s = await shop();
    const res = await s.sell({ placeOfSupplyStateCode: '29' });
    expect(res.status).toBe(400);
    expect(String(res.body.message)).toMatch(/seller GSTIN/);
    const counter = await s.sell();
    expect(counter.status).toBe(400);
    expect(String(counter.body.message)).toMatch(/seller GSTIN/);
  });

  it('falls back to the business GSTIN only for a branch in its state', async () => {
    await setBusinessGstin(BUSINESS);
    const sameState = await shop();
    await t.ok('PATCH', `/branches/${sameState.branch.id}`, admin, { stateCode: '29' });
    expect((await sameState.sell()).body.invoice.sellerGstin).toBe(BUSINESS);

    const ownGstin = await shop();
    await t.ok('PATCH', `/branches/${ownGstin.branch.id}`, admin, { gstin: KA_OTHER });
    expect((await ownGstin.sell()).body.invoice.sellerGstin).toBe(KA_OTHER);

    const otherState = await shop();
    await t.ok('PATCH', `/branches/${otherState.branch.id}`, admin, { stateCode: '27' });
    expect((await otherState.sell()).status).toBe(400);

    const noState = await shop();
    expect((await noState.sell()).body.invoice).toMatchObject({ sellerGstin: BUSINESS, sellerStateCode: '29' });
    await setBusinessGstin(null);
  });

  it("doesn't let a composition taxpayer sell to another state", async () => {
    const s = await shop();
    await t.ok('PATCH', `/branches/${s.branch.id}`, admin, { gstin: KA });
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: (await t.ok('GET', '/business/settings', admin)).timezone }).format(new Date());
    await t.ok('POST', '/business/taxpayer-type', admin, { taxpayerType: 'COMPOSITION', compositionCategory: 'TRADER', effectiveDate: today });
    const away = await s.sell({ placeOfSupplyStateCode: '27' });
    expect(away.status).toBe(400);
    expect(String(away.body.message)).toMatch(/composition taxpayer can't sell goods to another state/);
    const home = await s.sell({ placeOfSupplyStateCode: '29' });
    expect(home.status).toBe(200);
    expect(home.body.invoice).toMatchObject({ documentType: 'BILL_OF_SUPPLY', placeOfSupplyStateCode: '29' });
  });
});
