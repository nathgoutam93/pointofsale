import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from './helpers';

// #4: branch receipt CSS and document prefixes.
let t: TestApp;
let admin: string;
let branchId: string;
beforeAll(async () => {
  t = await startApp();
  admin = await t.login();
  branchId = (await t.branchWithRegister(admin)).branch.id;
});
afterAll(async () => { await t.close(); });

const patch = (body: unknown) => t.call('PATCH', `/branches/${branchId}`, admin, body);

describe('receipt CSS', () => {
  it.each([
    ['a </style> breakout', '</style><script>alert(1)</script>'],
    ['@import and url()', '@import url(https://evil.example/x.css); .a { background: url(https://evil/?q) }'],
    ['attribute selectors', 'input[value^="a"] { color: red }'],
    ['position: fixed overlays', '.a { position: fixed; z-index: 9999 }']
  ])('rejects %s, naming the problem', async (_name, css) => {
    const res = await patch({ invoiceCss: css });
    expect(res.status).toBe(400);
    expect(String(res.body.message)).toMatch(/invoiceCss/);
  });

  it('saves allowed CSS', async () => {
    const res = await patch({ invoiceCss: '#printable-invoice { --receipt-ch: 32; } @media print { .receipt-logo { max-height: 40px } }' });
    expect(res.status).toBe(200);
  });
});

describe('document prefixes', () => {
  it('accepts letters, digits, - and / in receipt prefixes, and rejects anything else', async () => {
    expect((await patch({ receiptPrefix: 'RCPT/26' })).status).toBe(200);
    expect((await patch({ receiptPrefix: 'RC</title>' })).status).toBe(400);
    expect((await patch({ receiptPrefix: 'RC PT' })).status).toBe(400);
  });

  it('takes only letters and digits in invoice and return series (see gst-numbers.test.ts)', async () => {
    expect((await patch({ invoicePrefix: 'IN</title>' })).status).toBe(400);
    expect((await patch({ invoicePrefix: 'INV/26' })).status).toBe(400);
  });
});
