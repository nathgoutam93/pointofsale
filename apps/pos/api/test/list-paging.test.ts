import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkoutBody, line, startApp, type TestApp } from './helpers';

// Lists that grow with every sale come a page at a time, newest first, filtered on the server.
let t: TestApp;
let admin: string;
let ctx: Awaited<ReturnType<TestApp['branchWithRegister']>>;
let itemId: string;
let customerId: string;
beforeAll(async () => {
  t = await startApp();
  admin = await t.login();
  ctx = await t.branchWithRegister(admin);
  itemId = (await t.item(ctx.token, ctx.branch.id, { stock: 500 })).id;
  customerId = (await t.ok('POST', '/customers', ctx.token, { branchId: ctx.branch.id, name: 'Paging Patel' })).id;
});
afterAll(async () => { await t.close(); });

type Row = { id: string; createdAt: string; invoiceNo?: string; status?: string };
const pageAfter = (rows: Row[]) => {
  const last = rows[rows.length - 1];
  return `&before=${encodeURIComponent(last.createdAt)}&beforeId=${last.id}`;
};

describe('list paging', () => {
  it('pages through sales newest first, with no bill skipped or repeated', async () => {
    const made: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      made.push((await t.ok('POST', '/sales/checkout', ctx.token, checkoutBody(ctx.branch.id, ctx.walkIn.id, [line(itemId)], [{ mode: 'CASH', amount: 100 }]))).invoice.id);
    }
    // Two made in the same millisecond still page apart cleanly.
    const same = (await t.db.saleInvoice.findUniqueOrThrow({ where: { id: made[3] } })).createdAt;
    await t.db.saleInvoice.update({ where: { id: made[4] }, data: { createdAt: same } });

    const seen: string[] = [];
    let page: Row[] = await t.ok('GET', `/sales?branchId=${ctx.branch.id}&limit=3`, ctx.token);
    while (page.length > 0) {
      seen.push(...page.map((row) => row.id));
      page = page.length === 3 ? await t.ok('GET', `/sales?branchId=${ctx.branch.id}&limit=3${pageAfter(page)}`, ctx.token) : [];
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.filter((id) => made.includes(id)).sort()).toEqual([...made].sort());
  });

  it('filters sales by search, status, money owed and customer', async () => {
    const credit = (await t.ok('POST', '/sales/checkout', ctx.token, checkoutBody(ctx.branch.id, customerId, [line(itemId)], []))).invoice;
    const list = (query: string) => t.ok<Row[]>('GET', `/sales?branchId=${ctx.branch.id}&${query}`, ctx.token);

    expect((await list('search=paging patel')).map((row) => row.id)).toEqual([credit.id]);
    expect((await list(`search=${encodeURIComponent(credit.invoiceNo)}`)).map((row) => row.id)).toEqual([credit.id]);
    expect((await list('owed=true')).map((row) => row.id)).toEqual([credit.id]);
    expect((await list('owed=false')).some((row) => row.id === credit.id)).toBe(false);
    expect((await list(`customerId=${customerId}`)).map((row) => row.id)).toEqual([credit.id]);
    expect((await list('status=DRAFT')).every((row) => row.status === 'DRAFT')).toBe(true);
    expect((await t.call('GET', `/sales?branchId=${ctx.branch.id}&owed=yes`, ctx.token)).status).toBe(400);
    expect((await t.call('GET', `/sales?branchId=${ctx.branch.id}&limit=5000`, ctx.token)).status).toBe(400);
  });

  it('pages returns and stock movements', async () => {
    for (let i = 0; i < 3; i += 1) {
      const sale = (await t.ok('POST', '/sales/checkout', ctx.token, checkoutBody(ctx.branch.id, ctx.walkIn.id, [line(itemId)], [{ mode: 'CASH', amount: 100 }]))).invoice;
      await t.ok('POST', `/sales/${sale.id}/return`, ctx.token, { lines: [{ saleLineId: sale.lines[0].id, qty: 1 }], refundMode: 'CASH', reason: 'Paging test' });
    }
    const first: Row[] = await t.ok('GET', `/returns?branchId=${ctx.branch.id}&limit=2`, ctx.token);
    const second: Row[] = await t.ok('GET', `/returns?branchId=${ctx.branch.id}&limit=2${pageAfter(first)}`, ctx.token);
    expect(first).toHaveLength(2);
    expect(second.length).toBeGreaterThanOrEqual(1);
    expect(second.some((row) => first.some((seen) => seen.id === row.id))).toBe(false);

    const movements: Row[] = await t.ok('GET', `/stock/ledger?branchId=${ctx.branch.id}&itemId=${itemId}&limit=4`, ctx.token);
    expect(movements).toHaveLength(4);
    const older: Row[] = await t.ok('GET', `/stock/ledger?branchId=${ctx.branch.id}&itemId=${itemId}&limit=4${pageAfter(movements)}`, ctx.token);
    expect(Date.parse(older[0].createdAt)).toBeLessThanOrEqual(Date.parse(movements[3].createdAt));
    expect(older.some((row) => movements.some((seen) => seen.id === row.id))).toBe(false);
  });
});
