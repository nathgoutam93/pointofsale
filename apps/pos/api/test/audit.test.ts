import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkoutBody, line, startApp, type TestApp } from './helpers';

// The audit log: who changed what, written with the change (nothing when it fails), read by admins.
let t: TestApp;
let admin: string;
beforeAll(async () => { t = await startApp(); admin = await t.login(); });
afterAll(async () => {
  await t.call('PATCH', '/business/settings', admin, { cashierMaxDiscountPercent: 10 });
  await t.close();
});

const entriesFor = (entityId: string) => t.db.auditEvent.findMany({ where: { entityId }, orderBy: { createdAt: 'asc' } });
const actionsFor = async (entityId: string) => (await entriesFor(entityId)).map((entry) => entry.action);

describe('audit log', () => {
  it('records price changes, and nothing for a change that fails', async () => {
    const ctx = await t.branchWithRegister(admin);
    const item = await t.item(ctx.token, ctx.branch.id, { sellPrice: 100, stock: 50 });
    await t.ok('PATCH', `/items/${item.id}`, ctx.token, { sellPrice: 90 });
    const [created, priced] = await entriesFor(item.id);
    expect(created).toMatchObject({ action: 'ITEM_CREATED', entityType: 'Item' });
    expect(priced).toMatchObject({ action: 'ITEM_PRICE_CHANGED', userName: 'admin', details: { changes: { sellPrice: [100, 90] } } });

    // Refused (above the MRP): nothing recorded.
    expect((await t.call('PATCH', `/items/${item.id}`, ctx.token, { mrp: 50 })).status).toBe(400);
    expect(await actionsFor(item.id)).toEqual(['ITEM_CREATED', 'ITEM_PRICE_CHANGED']);

    await t.ok('POST', '/stock/adjustment', ctx.token, { branchId: ctx.branch.id, itemId: item.id, qty: 2, direction: 'OUT', reason: 'Broken' });
    expect(await actionsFor(item.id)).toEqual(['ITEM_CREATED', 'ITEM_PRICE_CHANGED', 'STOCK_ADJUSTED']);
  });

  it('records cancellations, returns, wallet corrections, staff and settings', async () => {
    const ctx = await t.branchWithRegister(admin);
    const item = await t.item(ctx.token, ctx.branch.id, { stock: 50 });
    const customer = await t.ok('POST', '/customers', ctx.token, { branchId: ctx.branch.id, name: 'Audited customer' });

    const draft = await t.ok('POST', '/sales', ctx.token, { branchId: ctx.branch.id, customerId: customer.id, lines: [line(item.id)] });
    await t.ok('POST', `/sales/${draft.id}/cancel`, ctx.token, { reason: 'Changed their mind' });
    expect((await entriesFor(draft.id))[0]).toMatchObject({ action: 'SALE_CANCELLED', branchId: ctx.branch.id, details: { reason: 'Changed their mind' } });

    const sale = await t.ok('POST', '/sales/checkout', ctx.token, checkoutBody(ctx.branch.id, ctx.walkIn.id, [line(item.id)], [{ mode: 'CASH', amount: 100 }]));
    const ret = await t.ok('POST', `/sales/${sale.invoice.id}/return`, ctx.token, { lines: [{ saleLineId: sale.invoice.lines[0].id, qty: 1 }], refundMode: 'CASH', reason: 'Torn' });
    expect((await entriesFor(ret.id))[0]).toMatchObject({ action: 'RETURN_MADE', details: { refundAmount: 100, reason: 'Torn' } });

    await t.ok('POST', `/customers/${customer.id}/wallet/adjust?branchId=${ctx.branch.id}`, admin, { amount: 25, reason: 'Goodwill' });
    expect(await actionsFor(customer.id)).toEqual(['WALLET_ADJUSTED']);

    const cashier = await t.cashierWithRegister(admin, ctx.branch.id);
    await t.ok('PATCH', `/users/${cashier.userId}`, admin, { permissions: ['MAKE_RETURNS'] });
    expect(await actionsFor(cashier.userId)).toEqual(['USER_CREATED', 'USER_PERMISSIONS_CHANGED']);
    expect((await entriesFor(cashier.userId))[1].details).toEqual({ changes: { permissions: [[], ['MAKE_RETURNS']] } });

    await t.ok('POST', `/registers/${cashier.registerId}/close`, admin, { closingBalance: null });
    expect(await actionsFor(cashier.registerId)).toEqual(['REGISTER_CLOSED_FOR']);

    await t.ok('PATCH', '/business/settings', admin, { cashierMaxDiscountPercent: 15 });
    const settings = await t.db.auditEvent.findFirst({ where: { action: 'BUSINESS_SETTINGS_CHANGED' }, orderBy: { createdAt: 'desc' } });
    expect(settings?.details).toEqual({ changes: { cashierMaxDiscountPercent: [10, 15] } });
  });

  it('is read by admins, newest first, a page at a time', async () => {
    const page = await t.ok('GET', '/audit?limit=2', admin);
    expect(page).toHaveLength(2);
    expect(Date.parse(page[0].createdAt)).toBeGreaterThanOrEqual(Date.parse(page[1].createdAt));
    const next = await t.ok('GET', `/audit?limit=2&before=${encodeURIComponent(page[1].createdAt)}`, admin);
    expect(next.every((entry: { createdAt: string }) => Date.parse(entry.createdAt) < Date.parse(page[1].createdAt))).toBe(true);
    const returns = await t.ok('GET', '/audit?action=RETURN_MADE', admin);
    expect(returns.length).toBeGreaterThan(0);
    expect(returns.every((entry: { action: string }) => entry.action === 'RETURN_MADE')).toBe(true);

    const ctx = await t.branchWithRegister(admin);
    const cashier = await t.cashierWithRegister(admin, ctx.branch.id);
    expect((await t.call('GET', '/audit', cashier.token)).status).toBe(403);
  });
});
