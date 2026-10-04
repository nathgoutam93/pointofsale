import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkoutBody, line, startApp, type TestApp } from './helpers';

// Who may do what, where: admins manage any branch they have access to, with or without a
// register; cashiers sell at their register's branch and do only what an admin allowed them.
let t: TestApp;
let admin: string;
let a: Awaited<ReturnType<TestApp['branchWithRegister']>>;
let b: Awaited<ReturnType<TestApp['branchWithRegister']>>;
let itemId: string;
let customerId: string;
beforeAll(async () => {
  t = await startApp();
  admin = await t.login();
  a = await t.branchWithRegister(admin);
  b = await t.branchWithRegister(admin);
  itemId = (await t.item(a.token, a.branch.id, { stock: 50 })).id;
  customerId = (await t.ok('POST', '/customers', a.token, { branchId: a.branch.id, name: 'Permissions customer' })).id;
});
afterAll(async () => { await t.close(); });

const ok = (status: number) => status >= 200 && status < 300;

describe('cashier permissions', () => {
  it('lets a cashier do only what an admin allowed, at their own branch', async () => {
    const cashier = await t.cashierWithRegister(admin, a.branch.id);
    const unpaid = await t.ok('POST', '/sales', cashier.token, { branchId: a.branch.id, customerId, lines: [line(itemId)] });
    const attempts = {
      stock: () => t.call('POST', '/stock/adjustment', cashier.token, { branchId: a.branch.id, itemId, qty: 1, direction: 'IN', reason: 'Found one' }),
      items: () => t.call('POST', '/items', cashier.token, { code: `P${Date.now()}`, name: 'Cashier item', uom: 'PCS', sellPrice: 10, taxRate: 0 }),
      purchases: () => t.call('POST', '/purchases', cashier.token, { branchId: a.branch.id, supplierName: 'Acme', lines: [{ itemId, qty: 1, unitCost: 5 }] }),
      transfers: () => t.call('POST', '/stock-transfers', cashier.token, { fromBranchId: a.branch.id, toBranchId: b.branch.id, lines: [{ itemId, qty: 1 }] }),
      wallet: () => t.call('POST', `/customers/${customerId}/wallet/topup`, cashier.token, { amount: 50, mode: 'CASH' }),
      cancel: () => t.call('POST', `/sales/${unpaid.id}/cancel`, cashier.token, { reason: 'Test cancel' })
    };
    for (const [name, attempt] of Object.entries(attempts)) {
      const res = await attempt();
      expect(res.status, name).toBe(400);
      expect(res.body.message, name).toMatch(/aren't allowed/);
    }
    expect((await t.ok('GET', '/auth/me', cashier.token)).permissions).toEqual([]);

    const all = ['MANAGE_STOCK', 'MANAGE_ITEMS', 'RECORD_PURCHASES', 'SEND_TRANSFERS', 'TOP_UP_WALLETS', 'CANCEL_SALES'];
    const updated = await t.ok('PATCH', `/users/${cashier.userId}`, admin, { permissions: all });
    expect(updated.permissions).toEqual(all);
    expect((await t.ok('GET', '/auth/me', cashier.token)).permissions).toEqual(all);
    for (const [name, attempt] of Object.entries(attempts)) {
      expect(ok((await attempt()).status), name).toBe(true);
    }
    // Still only at their register's branch.
    const elsewhere = await t.call('POST', '/stock/adjustment', cashier.token, { branchId: b.branch.id, itemId, qty: 1, direction: 'IN', reason: 'Elsewhere' });
    expect(elsewhere.status).toBe(400);

    // Taken away again: refused at once, without signing in again.
    await t.ok('PATCH', `/users/${cashier.userId}`, admin, { permissions: [] });
    expect((await attempts.stock()).status).toBe(400);
  });

  it('are given when the cashier is created, and only to cashiers', async () => {
    const username = `perm-${Date.now()}`;
    const created = await t.ok('POST', '/users', admin, { branchId: a.branch.id, username, password: 'cashier-pass-1', permissions: ['MANAGE_STOCK'] });
    expect(created.permissions).toEqual(['MANAGE_STOCK']);
    const login = await t.ok('POST', '/auth/login', null, { businessCode: t.businessCode, username, password: 'cashier-pass-1' });
    expect(login.permissions).toEqual(['MANAGE_STOCK']);
    expect((await t.call('POST', '/users', admin, { branchId: a.branch.id, username: `${username}-x`, password: 'cashier-pass-1', permissions: ['NOPE'] })).status).toBe(400);

    const me = await t.ok('GET', '/auth/me', admin);
    expect((await t.call('PATCH', `/users/${me.userId}`, admin, { permissions: ['MANAGE_STOCK'] })).status).toBe(400);
  });
});

describe('admins and branches', () => {
  it('manage any branch they have access to, with no register open', async () => {
    // A register is open at A; branch B is managed all the same, and with no register at all.
    const bItem = (await t.item(b.token, b.branch.id, { stock: 0 })).id;
    for (const token of [a.token, admin]) {
      expect((await t.call('POST', '/stock/adjustment', token, { branchId: b.branch.id, itemId: bItem, qty: 2, direction: 'IN', reason: 'Count' })).status).toBe(201);
      expect((await t.call('GET', `/stock/on-hand?branchId=${b.branch.id}&itemId=${bItem}`, token)).status).toBe(200);
      expect((await t.call('GET', `/stock/ledger?branchId=${b.branch.id}`, token)).status).toBe(200);
      expect((await t.call('GET', `/customers?branchId=${b.branch.id}`, token)).status).toBe(200);
      expect((await t.call('GET', `/sales?branchId=${b.branch.id}`, token)).status).toBe(200);
      expect((await t.call('GET', `/returns?branchId=${b.branch.id}`, token)).status).toBe(200);
      expect((await t.call('GET', `/users?branchId=${b.branch.id}`, token)).status).toBe(200);
      expect((await t.call('PATCH', `/branches/${b.branch.id}`, token, { receiptFooter: 'Thank you' })).status).toBe(200);
    }
    expect(await t.onHand(admin, b.branch.id, bItem)).toBe(4);
  });

  it("still sell only at the register's branch", async () => {
    const res = await t.call('POST', '/sales/checkout', a.token, checkoutBody(b.branch.id, b.walkIn.id, [line(itemId)], [{ mode: 'CASH', amount: 100 }]));
    expect(res.status).toBe(400);
  });

  it("don't reach a branch they have no access to", async () => {
    const other = await t.newBranch(admin, 'Hidden');
    await t.db.userBranchAccess.deleteMany({ where: { branchId: other.id } });
    expect((await t.call('GET', `/sales?branchId=${other.id}`, admin)).status).toBe(400);
    expect((await t.call('GET', `/branches/${other.id}`, admin)).status).toBe(400);
  });

  it("let only the branch's own people read its settings", async () => {
    const cashier = await t.cashierWithRegister(admin, a.branch.id);
    expect((await t.call('GET', `/branches/${a.branch.id}`, cashier.token)).status).toBe(200);
    expect((await t.call('GET', `/branches/${b.branch.id}`, cashier.token)).status).toBe(400);
  });
});

describe('receiving transfers', () => {
  it("is open to anyone at the receiving branch; sending and calling back need the permission", async () => {
    const sent = await t.ok('POST', '/stock-transfers', admin, { fromBranchId: a.branch.id, toBranchId: b.branch.id, lines: [{ itemId, qty: 2 }] });
    const atSource = await t.cashierWithRegister(admin, a.branch.id);
    const atDestination = await t.cashierWithRegister(admin, b.branch.id);
    expect((await t.call('POST', `/stock-transfers/${sent.id}/cancel`, atSource.token)).status).toBe(400);
    // A cashier with no access to the receiving branch can't take it in.
    expect((await t.call('POST', `/stock-transfers/${sent.id}/receive`, atSource.token)).status).toBe(400);
    const received = await t.call('POST', `/stock-transfers/${sent.id}/receive`, atDestination.token);
    expect(received.status).toBe(200);
    expect(received.body).toMatchObject({ status: 'RECEIVED', closedByName: atDestination.username });
    expect(await t.onHand(admin, b.branch.id, itemId)).toBe(2);
  });
});
