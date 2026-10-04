import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CREDIT_LIMIT_EXCEEDED } from '@pos/contracts';
import { mailOutbox } from '../src/mail/mailer';
import { checkoutBody, line, startApp, type TestApp } from './helpers';

// Receivables: credit limits at checkout, due dates from payment terms, what a customer owes
// (and how much is overdue), statements and ageing.
let t: TestApp;
let admin: string;
let ctx: Awaited<ReturnType<TestApp['branchWithRegister']>>;
let cashier: Awaited<ReturnType<TestApp['cashierWithRegister']>>;
let itemId: string;
let customerId: string;
let timeZone: string;
const DAY = 24 * 60 * 60 * 1000;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());

beforeAll(async () => {
  process.env.MAIL_TRANSPORT = 'memory';
  t = await startApp();
  admin = await t.login();
  timeZone = (await t.ok('GET', '/business/settings', admin)).timezone;
  ctx = await t.branchWithRegister(admin);
  cashier = await t.cashierWithRegister(admin, ctx.branch.id);
  itemId = (await t.item(ctx.token, ctx.branch.id, { sellPrice: 500, stock: 100 })).id;
});
afterAll(async () => {
  delete process.env.MAIL_TRANSPORT;
  await t.close();
});

const sale = (token: string, qty: number, payments: unknown[] = []) =>
  t.call('POST', '/sales/checkout', token, checkoutBody(ctx.branch.id, customerId, [line(itemId, { qty, rate: 500 })], payments));

describe('credit limits and payment terms', () => {
  it('are set by admins only', async () => {
    const denied = await t.call('POST', '/customers', cashier.token, { branchId: ctx.branch.id, name: 'Too generous', creditLimit: 100000 });
    expect(denied.status).toBe(400);
    expect(denied.body.message).toMatch(/Only admins/);
    expect((await t.call('POST', '/customers', ctx.token, { branchId: ctx.branch.id, name: 'Negative', creditLimit: -1 })).status).toBe(400);

    const customer = await t.ok('POST', '/customers', ctx.token, { branchId: ctx.branch.id, name: 'Credit Stores', creditLimit: 2500, paymentTermsDays: 30 });
    expect(customer).toMatchObject({ creditLimit: 2500, paymentTermsDays: 30 });
    customerId = customer.id;
    // A cashier may still edit everything else.
    expect(await t.ok('PATCH', `/customers/${customerId}`, cashier.token, { phone: '9000000001' })).toMatchObject({ creditLimit: 2500 });
    expect((await t.call('PATCH', `/customers/${customerId}`, cashier.token, { paymentTermsDays: 90 })).status).toBe(400);
  });

  it('stop a cashier taking a customer past their limit; admins may', async () => {
    // 2000 on credit, due in 30 days.
    const first = await sale(cashier.token, 4);
    expect(first.status).toBe(200);
    const dueIn = (new Date(first.body.invoice.dueDate).getTime() - Date.now()) / DAY;
    expect(dueIn).toBeGreaterThan(28);
    expect(dueIn).toBeLessThanOrEqual(30);

    // Another 1000 on credit would make 3000: refused, and nothing is made or taken from stock.
    const before = await t.onHand(ctx.token, ctx.branch.id, itemId);
    const over = await sale(cashier.token, 2);
    expect(over.status).toBe(400);
    expect(over.body).toMatchObject({ code: CREDIT_LIMIT_EXCEEDED });
    expect(over.body.message).toMatch(/Credit Stores would owe Rs 3,000\.00, over their credit limit of Rs 2,500\.00/);
    expect(await t.onHand(ctx.token, ctx.branch.id, itemId)).toBe(before);
    // So is an unpaid bill made the two-step way.
    expect((await t.call('POST', '/sales', cashier.token, { branchId: ctx.branch.id, customerId, lines: [line(itemId, { qty: 2, rate: 500 })] })).status).toBe(400);

    // Half paid, it fits exactly; paid in full, the limit doesn't matter.
    expect((await sale(cashier.token, 2, [{ mode: 'CASH', amount: 500 }])).status).toBe(200);
    expect((await sale(cashier.token, 2, [{ mode: 'CASH', amount: 1000 }])).status).toBe(200);
    // An admin may go past it.
    expect((await sale(ctx.token, 2)).status).toBe(200);

    expect(await t.ok('GET', `/customers/${customerId}/account?branchId=${ctx.branch.id}`, cashier.token)).toEqual({
      customerId,
      creditLimit: 2500,
      paymentTermsDays: 30,
      outstanding: 3500,
      available: 0,
      overdue: 0,
      overdueBills: 0,
      oldestDueDate: null
    });
  });

  it('a customer with no terms has no due date, and no limit means no check', async () => {
    const open = await t.ok('POST', '/customers', ctx.token, { branchId: ctx.branch.id, name: 'Open Account' });
    const { invoice } = await t.ok('POST', '/sales/checkout', cashier.token, checkoutBody(ctx.branch.id, open.id, [line(itemId, { qty: 20, rate: 500 })], []));
    expect(invoice.dueDate).toBeNull();
    expect(await t.ok('GET', `/customers/${open.id}/account`, cashier.token)).toMatchObject({ creditLimit: null, available: null, outstanding: 10000, overdue: 0 });
  });
});

describe('overdue bills, ageing and statements', () => {
  it('count a bill past its due date as overdue, and age what is owed', async () => {
    // The first bill (2000) was made 45 days ago, due 15 days ago.
    const first = await t.db.saleInvoice.findFirstOrThrow({ where: { customerId, grandTotal: 2000 } });
    await t.db.saleInvoice.update({ where: { id: first.id }, data: { createdAt: new Date(Date.now() - 45 * DAY), dueDate: new Date(Date.now() - 15 * DAY) } });

    const account = await t.ok('GET', `/customers/${customerId}/account`, cashier.token);
    expect(account).toMatchObject({ outstanding: 3500, overdue: 2000, overdueBills: 1 });
    expect(new Date(account.oldestDueDate).getTime()).toBeCloseTo(Date.now() - 15 * DAY, -5);

    const ageing = await t.ok('GET', `/customers/ageing?branchId=${ctx.branch.id}`, cashier.token);
    const row = ageing.rows.find((r: { customerId: string }) => r.customerId === customerId);
    expect(row).toMatchObject({ name: 'Credit Stores', creditLimit: 2500, days0to30: 1500, days31to60: 2000, days61to90: 0, over90: 0, total: 3500, overdue: 2000 });
    // Most owed first: the open account owes 10000. (Customers are shared, so other tests' customers are here too.)
    const names = ageing.rows.map((r: { name: string }) => r.name);
    expect(names.indexOf('Open Account')).toBeLessThan(names.indexOf('Credit Stores'));
    const sum = (key: string) => Math.round(ageing.rows.reduce((total: number, r: Record<string, number>) => total + r[key], 0) * 100) / 100;
    expect(ageing.totals).toMatchObject({ total: sum('total'), overdue: sum('overdue'), days31to60: sum('days31to60') });
  });

  it('list bills, payments and returns with running balances', async () => {
    const first = await t.db.saleInvoice.findFirstOrThrow({ where: { customerId, grandTotal: 2000 }, include: { lines: true } });
    // One piece comes back (500 off what is owed), then 1600 is paid: 1500 settles it, 100 goes to the wallet.
    const ret = await t.ok('POST', `/sales/${first.id}/return`, cashier.token, { refundMode: 'CASH', lines: [{ saleLineId: first.lines[0].id, qty: 1 }] });
    await t.ok('POST', `/sales/${first.id}/settle`, cashier.token, { payments: [{ mode: 'CASH', amount: 1600 }] });

    const statement = await t.ok('GET', `/customers/${customerId}/statement?from=${today()}&to=${today()}`, cashier.token);
    // Before today: the first bill.
    expect(statement.openingBalance).toBe(2000);
    expect(statement.customer).toMatchObject({ name: 'Credit Stores', creditLimit: 2500 });
    const kinds = statement.entries.map((e: { kind: string; debit: number; credit: number }) => [e.kind, e.debit, e.credit]);
    expect(kinds).toEqual([
      ['BILL', 1000, 0],
      ['PAYMENT', 0, 500],
      ['BILL', 1000, 0],
      ['PAYMENT', 0, 1000],
      ['BILL', 1000, 0],
      ['RETURN', 0, 500],
      ['PAYMENT', 0, 1500]
    ]);
    expect(statement.entries.find((e: { kind: string }) => e.kind === 'RETURN')).toMatchObject({ reference: ret.returnNo });
    expect(statement.entries.at(-1).detail).toMatch(/Rs 100\.00 more to wallet/);
    expect(statement.totals).toEqual({ debit: 3000, credit: 3500 });
    expect(statement.closingBalance).toBe(1500);
    expect(statement.entries.at(-1).balance).toBe(1500);
    // Owed now: the half-paid bill and the admin's credit bill, both today's; nothing overdue.
    expect(statement.ageing).toEqual({ days0to30: 1500, days31to60: 0, days61to90: 0, over90: 0, total: 1500 });
    expect(statement.overdue).toBe(0);

    // A period with nothing in it: opening and closing balances only.
    const earlier = new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(Date.now() - 60 * DAY));
    const empty = await t.ok('GET', `/customers/${customerId}/statement?from=${earlier}&to=${earlier}`, cashier.token);
    expect(empty).toMatchObject({ openingBalance: 0, entries: [], closingBalance: 0 });
    expect((await t.call('GET', `/customers/${customerId}/statement?from=${today()}&to=${earlier}`, cashier.token)).status).toBe(400);
  });

  it('emails a statement', async () => {
    mailOutbox.length = 0;
    const from = new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(Date.now() - 60 * DAY));
    expect(await t.ok('POST', `/customers/${customerId}/statement/email`, cashier.token, { from, to: today(), email: 'accounts@credit.example' })).toEqual({ sent: true });
    const mail = mailOutbox.at(-1)!;
    expect(mail.to).toBe('accounts@credit.example');
    expect(mail.subject).toMatch(/Statement of account/);
    expect(mail.text).toMatch(/Credit Stores/);
    expect(mail.text).toMatch(/Closing balance .*Balance 1,500\.00/);
    expect(mail.html).toContain('<table');
  });

  it("isn't shown for a customer another branch can't use", async () => {
    await t.ok('PATCH', '/business/settings', admin, { customerScope: 'BRANCH' });
    try {
      const other = await t.branchWithRegister(admin);
      expect((await t.call('GET', `/customers/${customerId}/account?branchId=${other.branch.id}`, admin)).status).toBe(404);
      expect((await t.ok('GET', `/customers/ageing?branchId=${other.branch.id}`, admin)).rows).toEqual([]);
    } finally {
      await t.ok('PATCH', '/business/settings', admin, { customerScope: 'SHARED' });
    }
  });
});
