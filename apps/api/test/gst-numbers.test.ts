import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documentYearCode, financialYearStart } from '@pos/contracts';
import { checkoutBody, line, startApp, type TestApp } from './helpers';

// GST #36: invoices and credit notes are numbered {branch code}/{counter}/{YY}/{number}
// (credit notes with R after the code), within 16 characters and restarting each financial
// year, so every counter has its own series.
let t: TestApp;
let admin: string;
let yy: string;
let fyStart: number;

async function shop(code?: string) {
  const branch = code
    ? await t.ok('POST', '/branches', admin, { name: `Numbers ${code}`, code })
    : await t.newBranch(admin, 'Numbers');
  await t.ok('POST', '/registers/close', admin, { closingBalance: 0 }).catch(() => undefined);
  const opened = await t.ok('POST', '/registers/open', admin, { branchId: branch.id, openingBalance: 0 });
  const walkIn = await t.ok('GET', `/customers/walk-in/${branch.id}`, opened.token);
  const item = await t.item(opened.token, branch.id, { sellPrice: 100 });
  const [counter] = await t.ok('GET', `/branches/${branch.id}/counters`, opened.token);
  const sellAs = async (token: string) =>
    (await t.ok('POST', '/sales/checkout', token, checkoutBody(branch.id, walkIn.id, [line(item.id)], [{ mode: 'CASH', amount: 100 }]))).invoice;
  const sell = () => sellAs(opened.token);
  const refund = (token: string, invoice: { id: string; lines: Array<{ id: string }> }) =>
    t.ok('POST', `/sales/${invoice.id}/return`, token, { refundMode: 'CASH', lines: [{ saleLineId: invoice.lines[0].id, qty: 1 }] });
  return { branch, token: opened.token, counter, sell, sellAs, refund };
}

async function cashierAt(branchId: string) {
  const username = `till-${randomUUID().slice(0, 8)}`;
  await t.ok('POST', '/users', admin, { branchId, username, password: 'cashier-pass-1' });
  return t.login(username, 'cashier-pass-1');
}

beforeAll(async () => {
  t = await startApp();
  admin = await t.login();
  const timeZone = (await t.ok('GET', '/business/settings', admin)).timezone;
  const [year, month] = new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date()).split('-').map(Number);
  fyStart = financialYearStart(year, month);
  yy = documentYearCode(fyStart);
});
afterAll(async () => { await t.close(); });

describe('GST document numbers', () => {
  it('numbers invoices {code}/{counter}/{YY}/{5 digits} within 16 characters, and records series and year', async () => {
    const s = await shop();
    expect(s.counter.number).toBe(1);
    const first = await s.sell();
    const second = await s.sell();
    expect(first.invoiceNo).toBe(`${s.branch.code}/1/${yy}/00001`);
    expect(second.invoiceNo).toBe(`${s.branch.code}/1/${yy}/00002`);
    expect(first.invoiceNo.length).toBeLessThanOrEqual(16);
    expect(first).toMatchObject({ documentSeries: `${s.branch.code}/1`, fiscalYear: fyStart });
  });

  it('numbers credit notes with R after the branch code', async () => {
    const s = await shop();
    const refund = await s.refund(s.token, await s.sell());
    expect(refund.returnNo).toBe(`${s.branch.code}R/1/${yy}/00001`);
    expect(refund).toMatchObject({ documentSeries: `${s.branch.code}R/1`, fiscalYear: fyStart });
  });

  it("numbers each counter's documents in its own series", async () => {
    const s = await shop();
    const second = await t.ok('POST', `/branches/${s.branch.id}/counters`, admin, { name: 'Back' });
    expect(second.number).toBe(2);
    const cashier = await cashierAt(s.branch.id);
    const opened = await t.ok('POST', '/registers/open', cashier, { branchId: s.branch.id, counterId: second.id, openingBalance: 0 });

    expect((await s.sell()).invoiceNo).toBe(`${s.branch.code}/1/${yy}/00001`);
    const atSecond = await s.sellAs(opened.token);
    expect(atSecond.invoiceNo).toBe(`${s.branch.code}/2/${yy}/00001`);
    expect((await s.sell()).invoiceNo).toBe(`${s.branch.code}/1/${yy}/00002`);

    // A credit note is numbered at the counter giving the refund, not where the sale was made.
    expect((await s.refund(s.token, atSecond)).returnNo).toBe(`${s.branch.code}R/1/${yy}/00001`);
    expect((await s.refund(opened.token, await s.sell())).returnNo).toBe(`${s.branch.code}R/2/${yy}/00001`);
  });

  it('never reuses a counter number, even after a counter is deactivated', async () => {
    const s = await shop();
    const two = await t.ok('POST', `/branches/${s.branch.id}/counters`, admin, { name: 'Two' });
    await t.ok('PATCH', `/counters/${two.id}`, admin, { isActive: false });
    const three = await t.ok('POST', `/branches/${s.branch.id}/counters`, admin, { name: 'Three' });
    expect(three.number).toBe(3);
    // Added at the same moment, counters still get different numbers.
    const made = await Promise.all(['P1', 'P2', 'P3'].map((name) => t.ok('POST', `/branches/${s.branch.id}/counters`, admin, { name })));
    expect(made.map((counter) => counter.number).sort()).toEqual([4, 5, 6]);
  });

  it('takes branch codes of exactly 3 letters or digits, upper-cased', async () => {
    const free = await t.freeBranchCode();
    expect((await t.call('POST', '/branches', admin, { name: 'Long', code: `${free}X` })).status).toBe(400);
    expect((await t.call('POST', '/branches', admin, { name: 'Short', code: free.slice(0, 2) })).status).toBe(400);
    expect((await t.call('POST', '/branches', admin, { name: 'Dash', code: `${free.slice(0, 2)}-` })).status).toBe(400);
    const lower = await t.ok('POST', '/branches', admin, { name: 'Lower', code: free.toLowerCase() });
    expect(lower.code).toBe(free);
    expect((await t.call('PATCH', `/branches/${lower.id}`, admin, { code: 'ABCD' })).status).toBe(400);
  });

  it('numbers in the new code after a branch code changes', async () => {
    const s = await shop();
    await s.sell();
    const renamed = await t.freeBranchCode();
    await t.ok('PATCH', `/branches/${s.branch.id}`, admin, { code: renamed });
    expect((await s.sell()).invoiceNo).toBe(`${renamed}/1/${yy}/00001`);
  });

  it('never repeats a number when sales arrive at once', async () => {
    const s = await shop();
    const numbers = (await Promise.all([1, 2, 3, 4, 5, 6].map(() => s.sell()))).map((invoice) => invoice.invoiceNo).sort();
    expect(new Set(numbers).size).toBe(6);
    expect(numbers[5]).toBe(`${s.branch.code}/1/${yy}/00006`);
  });
});
