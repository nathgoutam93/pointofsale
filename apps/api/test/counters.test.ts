import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkoutBody, line, startApp, type TestApp } from './helpers';

// #40: several counters per branch, each with its own register.
let t: TestApp;
let admin: string;
beforeAll(async () => { t = await startApp(); admin = await t.login(); });
afterAll(async () => { await t.close(); });

async function newBranch() {
  return t.newBranch(admin, 'Counters');
}

async function cashier(branchId: string) {
  const username = `till-${randomUUID().slice(0, 8)}`;
  await t.ok('POST', '/users', admin, { branchId, username, password: 'cashier-pass-1' });
  return { username, token: await t.login(username, 'cashier-pass-1') };
}

const open = (token: string, branchId: string, counterId?: string, openingBalance = 0) =>
  t.call('POST', '/registers/open', token, { branchId, counterId, openingBalance });

describe('counters', () => {
  it('gives a new branch one counter, and lets only admins add, rename and deactivate them', async () => {
    const branch = await newBranch();
    const [first] = await t.ok('GET', `/branches/${branch.id}/counters`, admin);
    expect(first).toMatchObject({ name: 'Counter 1', isActive: true });

    const till = await cashier(branch.id);
    expect((await t.call('POST', `/branches/${branch.id}/counters`, till.token, { name: 'Counter 2' })).status).toBe(403);
    expect((await t.call('PATCH', `/counters/${first.id}`, till.token, { name: 'Front' })).status).toBe(403);
    // Cashiers can still see the branch's counters to pick one.
    expect(await t.ok('GET', `/branches/${branch.id}/counters`, till.token)).toHaveLength(1);

    const second = await t.ok('POST', `/branches/${branch.id}/counters`, admin, { name: '  Counter 2 ' });
    expect(second.name).toBe('Counter 2');
    expect((await t.call('POST', `/branches/${branch.id}/counters`, admin, { name: 'Counter 2' })).status).toBe(400);
    // Names are unique ignoring case, for new counters and renames alike.
    expect((await t.call('POST', `/branches/${branch.id}/counters`, admin, { name: 'counter 2' })).status).toBe(400);
    expect((await t.call('PATCH', `/counters/${first.id}`, admin, { name: 'COUNTER 2' })).status).toBe(400);
    // Changing only the case of a counter's own name is fine.
    expect((await t.ok('PATCH', `/counters/${second.id}`, admin, { name: 'COUNTER 2' })).name).toBe('COUNTER 2');
    await t.ok('PATCH', `/counters/${second.id}`, admin, { name: 'Counter 2' });
    expect((await t.call('POST', `/branches/${branch.id}/counters`, admin, { name: '' })).status).toBe(400);
    expect((await t.ok('PATCH', `/counters/${first.id}`, admin, { name: 'Front' })).name).toBe('Front');

    await t.ok('PATCH', `/counters/${second.id}`, admin, { isActive: false });
    expect(await t.ok('GET', `/branches/${branch.id}/counters`, admin)).toHaveLength(1);
    expect(await t.ok('GET', `/branches/${branch.id}/counters?includeInactive=true`, admin)).toHaveLength(2);
    // The last active counter stays.
    expect((await t.call('PATCH', `/counters/${first.id}`, admin, { isActive: false })).body.message).toBe(
      'A branch needs at least one active counter'
    );
  });

  it('runs a register per counter, so two cashiers sell in one branch at once', async () => {
    const branch = await newBranch();
    // Stock the branch from its only counter first.
    const setup = await open(admin, branch.id);
    const item = await t.item(setup.body.token, branch.id, { sellPrice: 10, stock: 100 });
    await t.ok('POST', '/registers/close', setup.body.token, { closingBalance: 0 });

    const [c1] = await t.ok('GET', `/branches/${branch.id}/counters`, admin);
    const c2 = await t.ok('POST', `/branches/${branch.id}/counters`, admin, { name: 'Counter 2' });
    const a = await cashier(branch.id);
    const b = await cashier(branch.id);

    // With two counters the cashier has to choose.
    expect((await open(a.token, branch.id)).body.message).toBe('Choose a counter');

    const ra = await open(a.token, branch.id, c1.id, 100);
    expect(ra.status).toBe(200);
    expect(ra.body.register).toMatchObject({ counterId: c1.id, counterName: 'Counter 1', openedBy: a.username });

    // The counter is taken, and a cashier can't hold two counters in a branch.
    expect((await open(b.token, branch.id, c1.id)).body.message).toBe(`Counter 1 is already open (by ${a.username}). Choose another counter.`);
    expect((await open(a.token, branch.id, c2.id)).body.message).toBe('You already have Counter 1 open in this branch. Close it before opening another.');

    const rb = await open(b.token, branch.id, c2.id, 50);
    expect(rb.status).toBe(200);

    // Each drawer only counts its own cash.
    const walkIn = await t.ok('GET', `/customers/walk-in/${branch.id}`, ra.body.token);
    const sell = (token: string, amount: number) =>
      t.ok('POST', '/sales/checkout', token, checkoutBody(branch.id, walkIn.id, [line(item.id, { rate: 10, qty: amount / 10 })], [{ mode: 'CASH', amount }]));
    await sell(ra.body.token, 100);
    await sell(rb.body.token, 30);
    await sell(rb.body.token, 20);
    expect(await t.ok('GET', '/registers/current', ra.body.token)).toMatchObject({ counterName: 'Counter 1', cashSales: 100, expectedCash: 200 });
    expect(await t.ok('GET', '/registers/current', rb.body.token)).toMatchObject({ counterName: 'Counter 2', cashSales: 50, expectedCash: 100 });

    const [summary] = (await t.ok<Array<{ branchId: string; counters: any[] }>>('GET', '/registers/summary', a.token)).filter(
      (s) => s.branchId === branch.id
    );
    expect(summary.counters.map((c) => [c.counter.name, c.current?.openedBy ?? null])).toEqual([
      ['Counter 1', a.username],
      ['Counter 2', b.username]
    ]);

    // An open counter can't be deactivated; closing one leaves the other open.
    expect((await t.call('PATCH', `/counters/${c2.id}`, admin, { isActive: false })).body.message).toBe(
      `Counter 2 is open (by ${b.username}). Close its register first.`
    );
    const closed = await t.ok('POST', '/registers/close', ra.body.token, { closingBalance: 200 });
    expect(closed.register).toMatchObject({ counterName: 'Counter 1', cashDifference: 0 });
    expect((await t.call('GET', '/registers/current', rb.body.token)).status).toBe(200);

    // Logging in again picks up the cashier's open counter.
    const login = await t.ok('POST', '/auth/login', null, { businessCode: t.businessCode, username: b.username, password: 'cashier-pass-1' });
    expect(login).toMatchObject({ registerId: rb.body.register.id, counterId: c2.id, counterName: 'Counter 2' });

    // The freed counter can be opened by the other cashier.
    expect((await open(b.token, branch.id, c1.id)).status).toBe(400); // b still runs Counter 2 here
    expect((await open(a.token, branch.id, c1.id)).status).toBe(200);
  });

  it('refuses counters that are inactive or from another branch', async () => {
    const branch = await newBranch();
    const other = await newBranch();
    const [otherCounter] = await t.ok('GET', `/branches/${other.id}/counters`, admin);
    const spare = await t.ok('POST', `/branches/${branch.id}/counters`, admin, { name: 'Spare' });
    await t.ok('PATCH', `/counters/${spare.id}`, admin, { isActive: false });
    const till = await cashier(branch.id);

    expect((await open(till.token, branch.id, otherCounter.id)).body.message).toBe('Counter not found in this branch');
    expect((await open(till.token, branch.id, spare.id)).body.message).toBe('Spare is inactive');
    // One active counter left, so no choice is needed.
    expect((await open(till.token, branch.id)).status).toBe(200);
    // A cashier without access to the other branch can't list its counters.
    expect((await t.call('GET', `/branches/${other.id}/counters`, till.token)).status).toBe(403);
  });

  it('opens each counter once when cashiers race for it', async () => {
    const branch = await newBranch();
    const [counter] = await t.ok('GET', `/branches/${branch.id}/counters`, admin);
    const tills = await Promise.all(Array.from({ length: 5 }, () => cashier(branch.id)));
    const results = await Promise.all(tills.map((till) => open(till.token, branch.id, counter.id)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await t.db.registerSession.count({ where: { counterId: counter.id, closedAt: null } })).toBe(1);
  });
});
