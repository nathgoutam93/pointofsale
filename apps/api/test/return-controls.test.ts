import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkoutBody, line, startApp, type TestApp } from './helpers';

// Returns hand out money: cashiers need the permission, every return says why and who made it,
// and past the business's return window only admins may take goods back.
let t: TestApp;
let admin: string;
let ctx: Awaited<ReturnType<TestApp['branchWithRegister']>>;
let itemId: string;
beforeAll(async () => {
  t = await startApp();
  admin = await t.login();
  ctx = await t.branchWithRegister(admin);
  itemId = (await t.item(ctx.token, ctx.branch.id, { stock: 100 })).id;
});
afterAll(async () => {
  await t.call('PATCH', '/business/settings', admin, { returnWindowDays: null });
  await t.close();
});

const sale = async () =>
  (await t.ok('POST', '/sales/checkout', ctx.token, checkoutBody(ctx.branch.id, ctx.walkIn.id, [line(itemId, { qty: 2 })], [{ mode: 'CASH', amount: 200 }]))).invoice;
const returnOne = (token: string, invoice: { id: string; lines: Array<{ id: string }> }, reason: unknown = 'Damaged in the box') =>
  t.call('POST', `/sales/${invoice.id}/return`, token, { lines: [{ saleLineId: invoice.lines[0].id, qty: 1 }], refundMode: 'CASH', reason });

describe('return controls', () => {
  it('need the permission for cashiers, and record the reason and who made them', async () => {
    const invoice = await sale();
    const without = await t.cashierWithRegister(admin, ctx.branch.id);
    const refused = await returnOne(without.token, invoice);
    expect(refused.status).toBe(403);
    expect(refused.body.message).toMatch(/aren't allowed/);

    const allowed = await t.cashierWithRegister(admin, ctx.branch.id, ['MAKE_RETURNS']);
    const made = await returnOne(allowed.token, invoice, '  Wrong size  ');
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ reason: 'Wrong size', createdByName: allowed.username });
    expect(await t.ok('GET', `/returns/${made.body.id}`, ctx.token)).toMatchObject({ reason: 'Wrong size', createdByName: allowed.username });
    expect((await t.ok('GET', `/returns?branchId=${ctx.branch.id}`, ctx.token)).find((row: { id: string }) => row.id === made.body.id)).toMatchObject({
      reason: 'Wrong size'
    });
  });

  it('need a reason', async () => {
    const invoice = await sale();
    expect((await returnOne(ctx.token, invoice, '  ')).status).toBe(400);
    expect((await returnOne(ctx.token, invoice, null)).status).toBe(400);
    expect(await t.db.returnInvoice.count({ where: { saleInvoiceId: invoice.id } })).toBe(0);
  });

  it('are limited to the return window for cashiers, not admins', async () => {
    const cashier = await t.cashierWithRegister(admin, ctx.branch.id, ['MAKE_RETURNS']);
    await t.ok('PATCH', '/business/settings', admin, { returnWindowDays: 7 });
    expect((await t.ok('GET', '/business/settings', admin)).returnWindowDays).toBe(7);

    const recent = await sale();
    await t.db.saleInvoice.update({ where: { id: recent.id }, data: { createdAt: new Date(Date.now() - 6 * 86_400_000) } });
    expect((await returnOne(cashier.token, recent)).status).toBe(201);

    const old = await sale();
    await t.db.saleInvoice.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - 9 * 86_400_000) } });
    const refused = await returnOne(cashier.token, old);
    expect(refused.status).toBe(400);
    expect(refused.body.message).toMatch(/within 7 days/);
    expect((await returnOne(ctx.token, old)).status).toBe(201); // an admin

    // 0: the same day only.
    await t.ok('PATCH', '/business/settings', admin, { returnWindowDays: 0 });
    const today = await sale();
    expect((await returnOne(cashier.token, today)).status).toBe(201);
    expect((await returnOne(cashier.token, recent)).status).toBe(400);

    await t.ok('PATCH', '/business/settings', admin, { returnWindowDays: null });
    expect((await returnOne(cashier.token, old)).status).toBe(201); // no limit
    expect((await t.call('PATCH', '/business/settings', admin, { returnWindowDays: -1 })).status).toBe(400);
  });
});
