import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { financialYearCode, financialYearStart } from '@pos/contracts';
import { checkoutBody, line, startApp, type TestApp } from './helpers';

// GST #36: invoices and credit notes are numbered {series}/{FY}/{number}, within 16
// characters and restarting each financial year; series are unique across branches.
let t: TestApp;
let admin: string;
let fy: string;
let fyStart: number;

const code = () => `N${randomUUID().replace(/-/g, '').slice(0, 7).toUpperCase()}`;

async function shop(branchCode = code()) {
  const branch = await t.ok('POST', '/branches', admin, { name: `Numbers ${branchCode}`, code: branchCode });
  await t.ok('POST', '/registers/close', admin, { closingBalance: 0 }).catch(() => undefined);
  const opened = await t.ok('POST', '/registers/open', admin, { branchId: branch.id, openingBalance: 0 });
  const walkIn = await t.ok('GET', `/customers/walk-in/${branch.id}`, opened.token);
  const item = await t.item(opened.token, branch.id, { sellPrice: 100 });
  const settings = await t.ok('GET', `/branches/${branch.id}`, opened.token);
  const sell = async () =>
    (await t.ok('POST', '/sales/checkout', opened.token, checkoutBody(branch.id, walkIn.id, [line(item.id)], [{ mode: 'CASH', amount: 100 }]))).invoice;
  return { branch, token: opened.token, settings, sell };
}

beforeAll(async () => {
  t = await startApp();
  admin = await t.login();
  const timeZone = (await t.ok('GET', '/business/settings', admin)).timezone;
  const [year, month] = new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date()).split('-').map(Number);
  fyStart = financialYearStart(year, month);
  fy = financialYearCode(fyStart);
});
afterAll(async () => { await t.close(); });

describe('GST document numbers', () => {
  it('gives a new branch invoice and return series from its code', async () => {
    const { settings } = await shop('ZQ123');
    expect(settings).toMatchObject({ invoicePrefix: 'ZQ123', returnPrefix: 'ZQ12R' });
    const second = await shop('ZQ1234'); // ZQ123 is taken
    expect(second.settings.invoicePrefix).toBe('ZQ122');
    expect(second.settings.returnPrefix).toBe('ZQ13R'); // ZQ12R is taken too
  });

  it('numbers invoices {series}/{FY}/{5 digits} within 16 characters, and records series and year', async () => {
    const s = await shop();
    const series = s.settings.invoicePrefix;
    const first = await s.sell();
    const second = await s.sell();
    expect(first.invoiceNo).toBe(`${series}/${fy}/00001`);
    expect(second.invoiceNo).toBe(`${series}/${fy}/00002`);
    expect(first.invoiceNo.length).toBeLessThanOrEqual(16);
    expect(first).toMatchObject({ documentSeries: series, fiscalYear: fyStart });
  });

  it('numbers credit notes in the return series', async () => {
    const s = await shop();
    const invoice = await s.sell();
    const refund = await t.ok('POST', `/sales/${invoice.id}/return`, s.token, {
      refundMode: 'CASH',
      lines: [{ saleLineId: invoice.lines[0].id, qty: 1 }]
    });
    expect(refund.returnNo).toBe(`${s.settings.returnPrefix}/${fy}/00001`);
    expect(refund).toMatchObject({ documentSeries: s.settings.returnPrefix, fiscalYear: fyStart });
  });

  it('keeps series unique, short and plain', async () => {
    const a = await shop();
    const b = await shop();
    const taken = await t.call('PATCH', `/branches/${b.branch.id}`, admin, { invoicePrefix: a.settings.invoicePrefix });
    expect(taken.status).toBe(400);
    expect(String(taken.body.message)).toMatch(/already used by/);
    expect((await t.call('PATCH', `/branches/${b.branch.id}`, admin, { invoicePrefix: 'ABCDEF' })).status).toBe(400);
    expect((await t.call('PATCH', `/branches/${b.branch.id}`, admin, { returnPrefix: 'R/1' })).status).toBe(400);
    expect((await t.ok('PATCH', `/branches/${b.branch.id}`, admin, { invoicePrefix: 'nb1' })).invoicePrefix).toBe('NB1');
  });

  it('carries on a series handed to another branch instead of starting it again', async () => {
    const a = await shop();
    const b = await shop();
    const series = `H${randomUUID().slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, '0')}`;
    await t.ok('PATCH', `/branches/${a.branch.id}`, admin, { invoicePrefix: series });
    await a.sell();
    await a.sell();
    await t.ok('PATCH', `/branches/${a.branch.id}`, admin, { invoicePrefix: `${series.slice(0, 4)}A` });
    await t.ok('PATCH', `/branches/${b.branch.id}`, admin, { invoicePrefix: series });
    expect((await b.sell()).invoiceNo).toBe(`${series}/${fy}/00003`);
  });

  it('never repeats a number when sales arrive at once', async () => {
    const s = await shop();
    const numbers = (await Promise.all([1, 2, 3, 4, 5, 6].map(() => s.sell()))).map((invoice) => invoice.invoiceNo).sort();
    expect(new Set(numbers).size).toBe(6);
    expect(numbers[5]).toBe(`${s.settings.invoicePrefix}/${fy}/00006`);
  });
});
