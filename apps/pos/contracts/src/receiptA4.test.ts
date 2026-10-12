import { describe, expect, it } from 'vitest';
import { a4InvoiceHtml, indianNumberWords, rupeesInWords } from './receiptA4.js';
import { renderReceipt, type ReceiptDocument } from './receiptLayout.js';
import { presetTemplate } from './receiptTemplate.js';

const doc: ReceiptDocument = {
  title: 'TAX INVOICE',
  storeName: 'Ravi & Sons <Pharmacy>',
  headerLines: ['MG Road, Pune'],
  footerLines: ['Thank you!'],
  legalFields: [{ label: 'GSTIN', value: '27ABCDE1234F1ZW' }],
  fields: [
    { label: 'Invoice', value: 'MAI/1/26/00007' },
    { label: 'Cashier', value: 'asha', key: 'cashier' }
  ],
  barcodeValue: 'MAI/1/26/00007',
  items: [
    { name: 'Cough Syrup', hsn: '3004', qty: 2, qtyLabel: '2 PCS', rate: 50, amount: 100, taxRate: 12, taxAmount: 12, discount: 0, total: 112, taxable: 100, batches: 'Batch A1 exp 2027-03-31' }
  ],
  itemsTotal: 112,
  orderDiscount: 0,
  taxTotals: [{ label: 'incl. CGST', amount: 6 }, { label: 'incl. SGST', amount: 6 }],
  grandTotalLabel: 'TOTAL',
  grandTotal: 112,
  payments: [{ label: 'Paid by CASH', amount: 112 }],
  due: 0,
  legalFooter: []
};

describe('A4 invoice', () => {
  it('says amounts in words the Indian way', () => {
    expect(indianNumberWords(0)).toBe('Zero');
    expect(indianNumberWords(118)).toBe('One Hundred Eighteen');
    expect(indianNumberWords(125000)).toBe('One Lakh Twenty Five Thousand');
    expect(indianNumberWords(32_10_45_007)).toBe('Thirty Two Crore Ten Lakh Forty Five Thousand Seven');
    expect(rupeesInWords(1180.5)).toBe('Rupees One Thousand One Hundred Eighty and Fifty Paise Only');
  });

  it('lays the document out as a page, escaping what it prints and following the template', () => {
    const template = presetTemplate('CLASSIC', 'A4');
    const rendered = renderReceipt(doc, template);
    expect(rendered.page).toEqual({ doc, sections: template.sections });
    // Thermal paper, or an explicit width (a computer's own printer), stays text.
    expect(renderReceipt(doc, presetTemplate('CLASSIC', '80MM')).page).toBeUndefined();
    expect(renderReceipt(doc, template, 48).page).toBeUndefined();

    const html = a4InvoiceHtml(doc, template.sections, '/uploads/logo.png');
    expect(html).toContain('Ravi &amp; Sons &lt;Pharmacy&gt;');
    expect(html).not.toContain('<Pharmacy>');
    expect(html).toContain('TAX INVOICE');
    expect(html).toContain('27ABCDE1234F1ZW');
    expect(html).toContain('Batch A1 exp 2027-03-31');
    expect(html).toContain('HSN/SAC');
    expect(html).toContain('Rupees One Hundred Twelve Only');
    expect(html).toContain('asha');
    // Switched off in the template: the cashier and HSN go; the GSTIN never does.
    const hidden = a4InvoiceHtml(doc, { ...template.sections, cashier: false, hsn: false, logo: false }, '/uploads/logo.png');
    expect(hidden).not.toContain('asha');
    expect(hidden).not.toContain('HSN/SAC');
    expect(hidden).not.toContain('logo.png');
    expect(hidden).toContain('27ABCDE1234F1ZW');
  });
});
