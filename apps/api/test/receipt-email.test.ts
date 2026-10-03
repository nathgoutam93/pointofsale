import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mailOutbox } from '../src/mail/mailer';
import { checkoutBody, line, startApp, type TestApp } from './helpers';

// Online: a sale's receipt sent to the customer by email, built by the server.
let t: TestApp;
let ctx: Awaited<ReturnType<TestApp['branchWithRegister']>>;
let invoiceId: string;
let invoiceNo: string;
beforeAll(async () => {
  process.env.MAIL_TRANSPORT = 'memory';
  t = await startApp();
  const admin = await t.login();
  ctx = await t.branchWithRegister(admin);
  const item = await t.item(ctx.token, ctx.branch.id, { sellPrice: 118, taxRate: 18, taxMode: 'INCLUSIVE' });
  const sale = await t.ok('POST', '/sales/checkout', ctx.token, checkoutBody(ctx.branch.id, ctx.walkIn.id, [line(item.id, { qty: 2, rate: 118, taxRate: 18, taxMode: 'INCLUSIVE' })], [{ mode: 'CASH', amount: 236 }]));
  invoiceId = sale.invoice.id;
  invoiceNo = sale.invoice.invoiceNo;
});
afterAll(async () => {
  delete process.env.MAIL_TRANSPORT;
  await t.close();
});
beforeEach(() => {
  mailOutbox.length = 0;
});

describe('emailed receipts', () => {
  it("send the sale's receipt, laid out like the printed one", async () => {
    const res = await t.call('POST', `/sales/${invoiceId}/email-receipt`, ctx.token, { email: 'Customer@Example.com' });
    expect(res.status).toBe(202);
    expect(mailOutbox).toHaveLength(1);
    const [mail] = mailOutbox;
    expect(mail.to).toBe('customer@example.com');
    expect(mail.subject).toContain(invoiceNo);
    expect(mail.text).toContain('TAX INVOICE');
    expect(mail.text).toContain(`Invoice  :`);
    expect(mail.text).toMatch(/TOTAL\s*:\s*236\.00/);
    expect(mail.text).toMatch(/incl\. CGST\s*:\s*18\.00/);
    expect(mail.text).toMatch(/Paid by CASH\s*:\s*236\.00/);
    expect(mail.html).toContain('font-family:Menlo');
  });

  it("only for the branch's own sales, and to a real address", async () => {
    const admin = await t.login();
    const other = await t.branchWithRegister(admin);
    const cashier = await t.cashierWithRegister(admin, other.branch.id);
    expect((await t.call('POST', `/sales/${invoiceId}/email-receipt`, cashier.token, { email: 'customer@example.com' })).status).toBe(404);
    expect((await t.call('POST', `/sales/${invoiceId}/email-receipt`, ctx.token, { email: 'not-an-email' })).status).toBe(400);
    expect(mailOutbox).toHaveLength(0);
  });

  it("says so when this server can't send email", async () => {
    delete process.env.MAIL_TRANSPORT;
    try {
      const res = await t.call('POST', `/sales/${invoiceId}/email-receipt`, ctx.token, { email: 'customer@example.com' });
      expect(res.status).toBe(503);
    } finally {
      process.env.MAIL_TRANSPORT = 'memory';
    }
  });
});
