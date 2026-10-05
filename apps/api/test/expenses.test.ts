import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from './helpers';

// Cash put into or taken out of the drawer, and the expense book.
let t: TestApp;
let admin: string;
let ctx: Awaited<ReturnType<TestApp['branchWithRegister']>>;
beforeAll(async () => {
  t = await startApp();
  admin = await t.login();
  ctx = await t.branchWithRegister(admin, 500);
});
afterAll(async () => { await t.close(); });

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const current = (token: string) => t.ok<{ expectedCash: number; cashIn: number; cashOut: number; cashExpenses: number }>('GET', '/registers/current', token);
const expense = (token: string, body: Record<string, unknown>) =>
  t.call('POST', '/expenses', token, { branchId: ctx.branch.id, category: 'Tea and snacks', amount: 40, mode: 'CASH', ...body });

describe('cash in and out of the drawer', () => {
  it('moves the cash expected at close, and never takes out more than is there', async () => {
    expect(await current(ctx.token)).toMatchObject({ expectedCash: 500, cashIn: 0, cashOut: 0, cashExpenses: 0 });
    expect((await t.call('POST', '/registers/cash-movements', ctx.token, { type: 'CASH_IN', amount: 200, reason: 'Change added' })).status).toBe(201);
    expect((await t.call('POST', '/registers/cash-movements', ctx.token, { type: 'CASH_OUT', amount: 300, reason: 'Cash to bank', note: 'SBI deposit' })).status).toBe(201);
    expect((await expense(ctx.token, { fromDrawer: true })).status).toBe(201);
    // A UPI expense, or cash from elsewhere, doesn't touch the drawer.
    expect((await expense(ctx.token, { mode: 'UPI', amount: 1000, category: 'Electricity', reference: 'UTR123' })).status).toBe(201);
    expect((await expense(ctx.token, { amount: 75 })).status).toBe(201);
    expect(await current(ctx.token)).toMatchObject({ expectedCash: 360, cashIn: 200, cashOut: 300, cashExpenses: 40 });

    const tooMuch = await t.call('POST', '/registers/cash-movements', ctx.token, { type: 'CASH_OUT', amount: 360.01, reason: 'Cash to owner' });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.message).toMatch(/Only 360.00 is expected/);
    expect((await expense(ctx.token, { fromDrawer: true, amount: 361 })).status).toBe(400);
    expect((await expense(ctx.token, { fromDrawer: true, mode: 'UPI' })).status).toBe(400);

    const entries = await t.ok<{ movements: Array<{ type: string }>; expenses: Array<{ amount: number }> }>('GET', '/registers/cash-movements', ctx.token);
    expect(entries.movements.map((row) => row.type)).toEqual(['CASH_OUT', 'CASH_IN']);
    expect(entries.expenses.map((row) => row.amount)).toEqual([40]);
  });

  it('needs the permission', async () => {
    const cashier = await t.cashierWithRegister(admin, ctx.branch.id);
    expect((await t.call('POST', '/registers/cash-movements', cashier.token, { type: 'CASH_IN', amount: 10, reason: 'Change added' })).status).toBe(403);
    expect((await expense(cashier.token, { fromDrawer: true })).status).toBe(403);
    expect((await t.call('GET', `/expenses?branchId=${ctx.branch.id}&from=${today()}&to=${today()}`, cashier.token)).status).toBe(403);

    const allowed = await t.cashierWithRegister(admin, ctx.branch.id, ['CASH_AND_EXPENSES']);
    expect((await t.call('POST', '/registers/cash-movements', allowed.token, { type: 'CASH_IN', amount: 10, reason: 'Change added' })).status).toBe(201);
    expect((await expense(allowed.token, { fromDrawer: true, amount: 10 })).status).toBe(201);
    expect(await current(allowed.token)).toMatchObject({ expectedCash: 0, cashIn: 10, cashExpenses: 10 });
    // Removing one is for admins.
    const mine = await t.ok<{ expenses: Array<{ id: string; createdByName: string }> }>('GET', `/expenses?branchId=${ctx.branch.id}&from=${today()}&to=${today()}`, allowed.token);
    const ownId = mine.expenses.find((row) => row.createdByName === allowed.username)!.id;
    expect((await t.call('DELETE', `/expenses/${ownId}`, allowed.token, { reason: 'Typo' })).status).toBe(403);
  });
});

describe('expense book', () => {
  it('lists a period by the day paid, with totals by category, and in the detail report', async () => {
    const own = await t.branchWithRegister(admin);
    const add = (body: Record<string, unknown>) => t.ok('POST', '/expenses', own.token, { branchId: own.branch.id, mode: 'BANK_TRANSFER', ...body });
    await add({ category: 'Rent', amount: 15000, date: '2026-09-01' });
    await add({ category: 'Electricity', amount: 2300.5, date: '2026-09-10' });
    await add({ category: 'Rent', amount: 15000, date: '2026-10-01' });
    expect((await t.call('POST', '/expenses', own.token, { branchId: own.branch.id, mode: 'CASH', category: 'Rent', amount: 1, date: '2999-01-01' })).status).toBe(400);
    expect((await t.call('POST', '/expenses', own.token, { branchId: own.branch.id, mode: 'CASH', category: 'Rent', amount: 1, date: '2026-09-01', fromDrawer: true })).status).toBe(400);

    const september = await t.ok<{ expenses: Array<{ date: string }>; byCategory: unknown[]; total: number }>(
      'GET', `/expenses?branchId=${own.branch.id}&from=2026-09-01&to=2026-09-30`, own.token
    );
    expect(september.expenses.map((row) => row.date)).toEqual(['2026-09-10', '2026-09-01']);
    expect(september.byCategory).toEqual([
      { category: 'Rent', count: 1, total: 15000 },
      { category: 'Electricity', count: 1, total: 2300.5 }
    ]);
    expect(september.total).toBe(17300.5);

    const report = await t.ok<{ expenses: { total: number; byCategory: Array<{ category: string; total: number }> } }>(
      'GET', `/reports/detail?branchId=${own.branch.id}&from=2026-09-01&to=2026-10-31`, admin
    );
    expect(report.expenses.total).toBe(32300.5);
    expect(report.expenses.byCategory[0]).toEqual({ category: 'Rent', count: 2, total: 30000 });
  });

  it('removes a mistake, but not a drawer expense once its register is closed', async () => {
    const own = await t.branchWithRegister(admin, 100);
    const fromDrawer = await t.ok<{ id: string }>('POST', '/expenses', own.token, { branchId: own.branch.id, mode: 'CASH', category: 'Cleaning', amount: 30, fromDrawer: true });
    const elsewhere = await t.ok<{ id: string }>('POST', '/expenses', own.token, { branchId: own.branch.id, mode: 'UPI', category: 'Cleaning', amount: 30 });
    expect((await t.call('DELETE', `/expenses/${elsewhere.id}`, admin, { reason: '' })).status).toBe(400);
    expect((await t.call('DELETE', `/expenses/${elsewhere.id}`, admin, { reason: 'Entered twice' })).status).toBe(200);

    const closed = await t.ok<{ register: { expectedCash: number; cashExpenses: number } }>('POST', '/registers/close', own.token, { closingBalance: 70 });
    expect(closed.register).toMatchObject({ expectedCash: 70, cashExpenses: 30 });
    expect((await t.call('DELETE', `/expenses/${fromDrawer.id}`, admin, { reason: 'Mistake' })).status).toBe(400);

    const audit = await t.db.auditEvent.findMany({ where: { branchId: own.branch.id }, select: { action: true } });
    expect(audit.map((row) => row.action).sort()).toEqual(['EXPENSE_RECORDED', 'EXPENSE_RECORDED', 'EXPENSE_REMOVED']);
  });
});
