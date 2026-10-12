import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gstinCheckCharacter } from '@pos/contracts';
import { startApp, type TestApp } from './helpers';

// GST on purchases: a registered supplier charges it (CGST + SGST from the same state, IGST from
// another); it is input tax credit for a regular taxpayer under a GSTIN, and GSTR-3B Table 4 adds it up.
let t: TestApp;
let admin: string;
let month: string;
const gstin = (prefix: string) => {
  const first14 = `${prefix}${String(Date.now()).slice(-4)}C1Z`;
  return first14 + gstinCheckCharacter(first14);
};
const OURS = gstin('29PURCH');
const SAME_STATE = gstin('29SUPPL');
const OTHER_STATE = gstin('27SUPPL');

beforeAll(async () => {
  t = await startApp();
  admin = await t.login();
  await t.db.taxpayerTypeChange.deleteMany({});
  const timeZone = (await t.ok('GET', '/business/settings', admin)).timezone;
  month = new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date()).slice(0, 7);
});
afterAll(async () => { await t.close(); });

describe('purchase GST', () => {
  it('splits the tax by supplier state, counts it as ITC and shows it in GSTR-3B', async () => {
    const ctx = await t.branchWithRegister(admin);
    await t.ok('PATCH', `/branches/${ctx.branch.id}`, admin, { gstin: OURS });
    const item = await t.item(ctx.token, ctx.branch.id, { taxRate: 18, stock: 0 });
    const buy = (body: Record<string, unknown>) =>
      t.ok('POST', '/purchases', ctx.token, { branchId: ctx.branch.id, supplierName: `Supplier ${randomUUID().slice(0, 4)}`, ...body });

    // Same state, the item's 18%: CGST + SGST.
    const local = await buy({ supplierGstin: SAME_STATE, lines: [{ itemId: item.id, qty: 10, unitCost: 100 }] });
    expect(local).toMatchObject({ buyerGstin: OURS, itcEligible: true, cgstTotal: '90', sgstTotal: '90', igstTotal: '0', taxTotal: '180' });
    expect(local.lines[0]).toMatchObject({ taxRate: '18', cgstAmount: '90', sgstAmount: '90' });
    // Another state at 12% (given on the line): IGST.
    const interState = await buy({ supplierGstin: OTHER_STATE, lines: [{ itemId: item.id, qty: 5, unitCost: 100, taxRate: 12 }] });
    expect(interState).toMatchObject({ itcEligible: true, igstTotal: '60', cgstTotal: '0' });
    // An unregistered supplier charges none.
    const unregistered = await buy({ lines: [{ itemId: item.id, qty: 1, unitCost: 100, taxRate: 18 }] });
    expect(unregistered).toMatchObject({ itcEligible: false, taxTotal: '0' });
    // The cost stays before tax (the tax comes back as credit).
    expect(Number((await t.db.item.findUniqueOrThrow({ where: { id: item.id } })).costPrice)).toBe(100);

    const gstr3b = await t.ok('GET', `/gst/gstr3b?gstin=${OURS}&from=${month}&to=${month}`, admin);
    expect(gstr3b.table4).toEqual({ itcAvailable: { iamt: 60, camt: 90, samt: 90, csamt: 0 }, purchases: 2, purchaseReturns: 0 });
    expect(gstr3b.problems.some((problem: { message: string }) => /comes from 2 purchases/.test(problem.message))).toBe(true);
  });
});
