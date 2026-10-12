import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gstinCheckCharacter } from '@pos/contracts';
import { addDays, supplierLedger } from '../src/suppliers/supplier-ledger';
import { startApp, type TestApp } from './helpers';

// Supplier accounts: purchases owe the supplier their total with GST; goods sent back (debit
// notes) and payments take it off, the oldest bills paid first. Cash paid from the drawer
// comes off the cash expected at close, and goods sent back take their GST off input tax credit.
let t: TestApp;
let admin: string;
let ctx: Awaited<ReturnType<TestApp['branchWithRegister']>>;
let itemId: string;
let today: string;
let month: string;
const gstin = (prefix: string) => {
  const first14 = `${prefix}${String(Date.now()).slice(-4)}C1Z`;
  return first14 + gstinCheckCharacter(first14);
};
const OURS = gstin('29SUPAC');
const THEIRS = gstin('29VENDR');
const unique = (label: string) => `${label} ${randomUUID().slice(0, 6)}`;

beforeAll(async () => {
  t = await startApp();
  admin = await t.login();
  await t.db.taxpayerTypeChange.deleteMany({});
  ctx = await t.branchWithRegister(admin);
  await t.ok('PATCH', `/branches/${ctx.branch.id}`, admin, { gstin: OURS });
  itemId = (await t.item(ctx.token, ctx.branch.id, { taxRate: 18, stock: 0 })).id;
  const timeZone = (await t.ok('GET', '/business/settings', admin)).timezone;
  today = new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
  month = today.slice(0, 7);
});
afterAll(async () => { await t.close(); });

const buy = (supplierId: string, qty: number, unitCost: number, extra: Record<string, unknown> = {}) =>
  t.ok('POST', '/purchases', ctx.token, { branchId: ctx.branch.id, supplierId, lines: [{ itemId, qty, unitCost }], ...extra });
const account = (supplierId: string) => t.ok('GET', `/suppliers/${supplierId}/account`, admin);

describe('suppliers', () => {
  it('are added once by name, and a purchase by name finds them', async () => {
    const name = unique('Acme Traders');
    const supplier = await t.ok('POST', '/suppliers', admin, { name, gstin: THEIRS, paymentTermsDays: 30 });
    expect(supplier).toMatchObject({ name, gstin: THEIRS, paymentTermsDays: 30, balance: 0, overdue: 0, isActive: true });
    const again = await t.call('POST', '/suppliers', admin, { name: `  ${name.toUpperCase()} ` });
    expect(again.status).toBe(400);
    expect(again.body.message).toMatch(/already a supplier/);

    // An older app still sends the supplier's name: the same supplier, with their GSTIN.
    const byName = await t.ok('POST', '/purchases', ctx.token, { branchId: ctx.branch.id, supplierName: name.toLowerCase(), lines: [{ itemId, qty: 1, unitCost: 100 }] });
    expect(byName).toMatchObject({ supplierId: supplier.id, supplierName: name, supplierGstin: THEIRS, itcEligible: true });
    // A new name adds a supplier.
    const fresh = await t.ok('POST', '/purchases', ctx.token, { branchId: ctx.branch.id, supplierName: unique('Kumar & Sons'), lines: [{ itemId, qty: 1, unitCost: 10 }] });
    expect(fresh.supplierId).toBeTruthy();
    expect((await t.ok('GET', '/suppliers', admin)).some((row: { id: string }) => row.id === fresh.supplierId)).toBe(true);
  });

  it('owe what purchases cost with GST, due after the payment terms, paid oldest first', async () => {
    const supplier = await t.ok('POST', '/suppliers', admin, { name: unique('Bharat Foods'), gstin: THEIRS, paymentTermsDays: 30 });
    // Billed 60 days ago (due 30 days ago, so overdue), and today (due in 30 days).
    const old = await buy(supplier.id, 10, 100, { supplierInvoiceNo: 'BF-1', supplierInvoiceDate: addDays(today, -60) });
    expect(old).toMatchObject({ grandTotal: '1180', dueDate: addDays(today, -30) });
    const recent = await buy(supplier.id, 5, 100, { supplierInvoiceNo: 'BF-2' });
    expect(recent).toMatchObject({ grandTotal: '590', dueDate: addDays(today, 30) });

    let acc = await account(supplier.id);
    expect(acc.supplier).toMatchObject({ balance: 1770, overdue: 1180 });
    expect(acc.openBills.map((bill: { purchaseNo: string; outstanding: number; overdue: boolean }) => [bill.purchaseNo, bill.outstanding, bill.overdue])).toEqual([
      [old.purchaseNo, 1180, true],
      [recent.purchaseNo, 590, false]
    ]);

    // A part payment by bank pays the oldest bill first.
    await t.ok('POST', `/suppliers/${supplier.id}/payments`, admin, { branchId: ctx.branch.id, amount: 1000, mode: 'BANK_TRANSFER', reference: 'UTR123' });
    acc = await account(supplier.id);
    expect(acc.supplier).toMatchObject({ balance: 770, overdue: 180 });
    expect(acc.openBills.map((bill: { outstanding: number }) => bill.outstanding)).toEqual([180, 590]);
    expect(acc.entries.map((entry: { kind: string; amount: number; balance: number }) => [entry.kind, entry.amount, entry.balance])).toEqual([
      ['PURCHASE', 1180, 1180],
      ['PURCHASE', 590, 1770],
      ['PAYMENT', 1000, 770]
    ]);
    expect((await t.ok('GET', '/suppliers', admin)).find((row: { id: string }) => row.id === supplier.id)).toMatchObject({ balance: 770, overdue: 180 });
    expect((await t.ok('GET', `/purchases?branchId=${ctx.branch.id}&supplierId=${supplier.id}`, admin))).toHaveLength(2);
  });

  it('take cash from the drawer only with an open register, and the drawer expects less', async () => {
    const supplier = await t.ok('POST', '/suppliers', admin, { name: unique('Milk Man') });
    await buy(supplier.id, 2, 50);
    const before = (await t.ok('GET', '/registers/current', ctx.token)).expectedCash;

    expect((await t.call('POST', `/suppliers/${supplier.id}/payments`, ctx.token, { branchId: ctx.branch.id, amount: 100, mode: 'UPI', fromDrawer: true })).status).toBe(400);
    const elsewhere = await t.branchWithRegister(admin);
    const wrongBranch = await t.call('POST', `/suppliers/${supplier.id}/payments`, elsewhere.token, { branchId: ctx.branch.id, amount: 100, mode: 'CASH', fromDrawer: true });
    expect(wrongBranch.status).toBe(400);

    const paid = await t.ok('POST', `/suppliers/${supplier.id}/payments`, ctx.token, { branchId: ctx.branch.id, amount: 100, mode: 'CASH', fromDrawer: true });
    expect(paid).toMatchObject({ amount: 100, mode: 'CASH', registerSessionId: ctx.registerId });
    const after = await t.ok('GET', '/registers/current', ctx.token);
    expect(after).toMatchObject({ cashPaidOut: 100, expectedCash: before - 100 });
    expect((await account(supplier.id)).supplier.balance).toBe(0);

    // Cashiers need the permission to pay suppliers.
    const cashier = await t.cashierWithRegister(admin, ctx.branch.id, ['RECORD_PURCHASES']);
    const refused = await t.call('POST', `/suppliers/${supplier.id}/payments`, cashier.token, { branchId: ctx.branch.id, amount: 1, mode: 'CASH', fromDrawer: true });
    expect(refused.status).toBe(403);
    const allowed = await t.cashierWithRegister(admin, ctx.branch.id, ['PAY_SUPPLIERS']);
    expect((await t.call('POST', `/suppliers/${supplier.id}/payments`, allowed.token, { branchId: ctx.branch.id, amount: 1, mode: 'CASH', fromDrawer: true })).status).toBe(201);
    // Seeing suppliers needs one of the two.
    const neither = await t.cashierWithRegister(admin, ctx.branch.id);
    expect((await t.call('GET', '/suppliers', neither.token)).status).toBe(403);
    expect((await t.call('GET', '/suppliers', allowed.token)).status).toBe(200);
  });
});

describe('purchase returns', () => {
  it('send goods back: out of stock, off the account, with the GST prorated and taken off ITC', async () => {
    const supplier = await t.ok('POST', '/suppliers', admin, { name: unique('Return Co'), gstin: THEIRS });
    const before = await t.onHand(admin, ctx.branch.id, itemId);
    // 3 at ₹33.33 + 18%: 99.99, CGST 8.99 + SGST 9.00.
    const purchase = await buy(supplier.id, 3, 33.33);
    expect(await t.onHand(admin, ctx.branch.id, itemId)).toBe(before + 3);
    const itcBefore = (await t.ok('GET', `/gst/gstr3b?gstin=${OURS}&from=${month}&to=${month}`, admin)).table4.itcAvailable;
    const lineId = purchase.lines[0].id;
    const sendBack = (qty: number, reason = 'Damaged in transit') => t.call('POST', `/purchases/${purchase.id}/returns`, ctx.token, { lines: [{ purchaseLineId: lineId, qty }], reason });

    const first = await sendBack(1);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ purchaseNo: purchase.purchaseNo, supplierName: supplier.name, itcReversed: true, taxableTotal: 33.33, reason: 'Damaged in transit' });
    expect(first.body.returnNo).toMatch(/^PRT-/);
    expect(first.body.totalAmount).toBe(round(first.body.taxableTotal + first.body.taxTotal));
    expect(await t.onHand(admin, ctx.branch.id, itemId)).toBe(before + 2);

    expect((await sendBack(3)).status).toBe(400); // only 2 left of the purchase
    expect((await sendBack(1, 'no')).status).toBe(400); // a reason is needed
    const rest = (await sendBack(2)).body;
    // Together exactly the purchase line, so nothing is owed.
    expect(round(first.body.totalAmount + rest.totalAmount)).toBe(Number(purchase.grandTotal));
    expect(round(first.body.cgstTotal + rest.cgstTotal)).toBe(Number(purchase.cgstTotal));
    expect((await account(supplier.id)).supplier.balance).toBe(0);
    expect((await sendBack(1)).status).toBe(400);

    const detail = await t.ok('GET', `/purchases/${purchase.id}`, admin);
    expect(detail.lines[0].returnedQty).toBe(3);
    expect(detail.returns.map((entry: { returnNo: string }) => entry.returnNo)).toEqual([first.body.returnNo, rest.returnNo]);
    expect((await t.ok('GET', `/purchase-returns?branchId=${ctx.branch.id}&limit=5`, admin)).slice(0, 2).map((entry: { id: string }) => entry.id)).toEqual([rest.id, first.body.id]);
    const ledger = await t.ok('GET', `/stock/ledger?branchId=${ctx.branch.id}&itemId=${itemId}&limit=2`, admin);
    expect(ledger[0]).toMatchObject({ txnType: 'PURCHASE_RETURN' });
    expect(Number(ledger[0].qtyOut)).toBe(2);

    // GSTR-3B: the returns take their GST off again, so this purchase adds nothing net.
    const gstr3b = await t.ok('GET', `/gst/gstr3b?gstin=${OURS}&from=${month}&to=${month}`, admin);
    expect(gstr3b.table4.purchaseReturns).toBe(2);
    expect(round(itcBefore.camt - gstr3b.table4.itcAvailable.camt)).toBe(Number(purchase.cgstTotal));
    expect(round(itcBefore.samt - gstr3b.table4.itcAvailable.samt)).toBe(Number(purchase.sgstTotal));
    expect(gstr3b.problems.some((problem: { message: string }) => /less the GST on 2 returns to suppliers/.test(problem.message))).toBe(true);
  });

  it("can't send back goods no longer in stock", async () => {
    const supplier = await t.ok('POST', '/suppliers', admin, { name: unique('Gone Goods') });
    const other = (await t.item(ctx.token, ctx.branch.id, { stock: 0 })).id;
    const purchase = await t.ok('POST', '/purchases', ctx.token, { branchId: ctx.branch.id, supplierId: supplier.id, lines: [{ itemId: other, qty: 2, unitCost: 10 }] });
    await t.ok('POST', '/stock/adjustment', admin, { branchId: ctx.branch.id, itemId: other, qty: 2, direction: 'OUT', reason: 'Sold elsewhere' });
    const refused = await t.call('POST', `/purchases/${purchase.id}/returns`, ctx.token, { lines: [{ purchaseLineId: purchase.lines[0].id, qty: 1 }], reason: 'Wrong item' });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toMatch(/Insufficient stock/);
  });
});

describe('supplier ledger', () => {
  const at = (day: number) => new Date(Date.UTC(2026, 0, day));
  const purchase = (id: string, total: number, date: string, dueDate: string | null, settled = false) => ({
    id, purchaseNo: id, supplierInvoiceNo: null, date, dueDate, grandTotal: total, createdAt: at(Number(date.slice(8))), settledBeforeAccounts: settled
  });

  it('takes returns off their own purchase, then pays the oldest bills first', () => {
    const ledger = supplierLedger({
      purchases: [purchase('P1', 100, '2026-01-01', '2026-01-10'), purchase('P2', 200, '2026-01-05', '2026-02-05'), purchase('OLD', 50, '2025-12-01', null, true)],
      returns: [{ id: 'R1', returnNo: 'R1', purchaseId: 'P2', totalAmount: 50, createdAt: at(6) }, { id: 'R2', returnNo: 'R2', purchaseId: 'OLD', totalAmount: 20, createdAt: at(7) }],
      payments: [{ id: 'X1', amount: 90, mode: 'CASH', reference: null, createdAt: at(8) }],
      today: '2026-01-20'
    });
    // Owed 300 - 50 - 20 - 90 = 140. P2's return comes off P2 (150 left); the return on the old,
    // paid purchase and the payment (110) pay P1 (100) and 10 of P2.
    expect(ledger.balance).toBe(140);
    expect(ledger.openBills).toEqual([expect.objectContaining({ purchaseId: 'P2', outstanding: 140, overdue: false })]);
    expect(ledger.overdue).toBe(0);
    expect(ledger.entries.map((entry) => entry.balance)).toEqual([100, 300, 250, 230, 140]);
  });
});

function round(value: number) {
  return Math.round(value * 100) / 100;
}
