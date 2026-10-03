import { describe, expect, it } from 'vitest';
import { code128Modules, code128Values, CODE128_PATTERNS } from './code128.js';
import { renderReceipt, type ReceiptDocument } from './receiptLayout.js';
import {
  presetTemplate,
  RECEIPT_PAPER_IDS,
  RECEIPT_PAPERS,
  RECEIPT_SECTIONS,
  RECEIPT_STYLES,
  resolveReceiptTemplate,
  type ReceiptSections,
  type ReceiptTemplate
} from './receiptTemplate.js';

const sale: ReceiptDocument = {
  title: 'TAX INVOICE',
  storeName: 'Everyday Market Bengaluru Super Store and Pharmacy',
  headerLines: ['12th Cross, Indiranagar 2nd Stage, Bengaluru 560038', 'Ph 080-4123 4567'],
  footerLines: ['Thank you for shopping with us! Goods once sold can be exchanged within 7 days.'],
  legalFields: [
    { label: 'GSTIN', value: '29ABCDE1234F1ZW' },
    { label: 'Place of Supply', value: '33 - Tamil Nadu', fullLine: true }
  ],
  fields: [
    { label: 'Invoice', value: 'MAI/1/26/00080' },
    { label: 'Date', value: '03-10-2026' },
    { label: 'Cashier', value: 'priya.sharma', key: 'cashier' },
    { label: 'Customer', value: 'Walk In Customer', key: 'customer' }
  ],
  barcodeValue: 'MAI/1/26/00080',
  items: [
    {
      name: 'Basmati Rice Premium Long Grain Extra Aged 5 kg Family Pack',
      hsn: '1006',
      qty: 2,
      qtyLabel: '2 BAG',
      rate: 475.24,
      amount: 950.48,
      taxRate: 5,
      taxAmount: 47.52,
      discount: 20,
      total: 978,
      taxable: 930.48
    },
    { name: 'Dish Wash Liquid 500 ml', hsn: '3402', qty: 1.5, qtyLabel: '1.5 L', rate: 100.85, amount: 151.27, taxRate: 18, taxAmount: 27.23, discount: 0, total: 178.5, taxable: 151.27 },
    { name: 'Notebook', hsn: null, qty: 3, qtyLabel: '3 PCS', rate: 79.46, amount: 238.39, taxRate: 12, taxAmount: 28.61, discount: 0, total: 267, taxable: 238.39 }
  ],
  itemsTotal: 1423.5,
  orderDiscount: 23.5,
  taxTotals: [
    { label: 'incl. IGST', amount: 103.36 }
  ],
  grandTotalLabel: 'TOTAL',
  grandTotal: 1400,
  payments: [
    { label: 'Paid by CASH', amount: 1000 },
    { label: 'Paid by CARD', amount: 300 }
  ],
  due: 100,
  legalFooter: []
};

const allSections = (value: boolean) => Object.fromEntries(RECEIPT_SECTIONS.map((section) => [section, value])) as ReceiptSections;
const text = (template: ReceiptTemplate, doc = sale) => renderReceipt(doc, template).lines.map((line) => line.text).join('\n');

describe('renderReceipt', () => {
  const cases = RECEIPT_PAPER_IDS.flatMap((paper) =>
    RECEIPT_STYLES.flatMap((style) =>
      [true, false, null].map((on) => ({ paper, style, on }))
    )
  );

  it.each(cases)('$style on $paper (sections $on) fills the paper exactly', ({ paper, style, on }) => {
    const template = presetTemplate(style, paper);
    if (on !== null) template.sections = allSections(on);
    const { lines, columns } = renderReceipt(sale, template);
    expect(columns).toBe(RECEIPT_PAPERS[paper].columns);
    for (const line of lines) {
      expect(line.text.length, JSON.stringify(line)).toBe(line.large ? Math.floor(columns / 2) : columns);
    }
  });

  it('prints what the law needs even with every section off', () => {
    const template = presetTemplate('MINIMAL', '80MM');
    template.sections = allSections(false);
    const out = text(template, { ...sale, legalFooter: ['Composition taxable person, not eligible to collect tax on supplies'] });
    for (const required of ['TAX INVOICE', 'GSTIN', '29ABCDE1234F1ZW', 'Place of Supply: 33 - Tamil Nadu', 'MAI/1/26/00080', 'incl. IGST', '103.36', 'Remaining Due', 'Composition taxable person']) {
      expect(out).toContain(required);
    }
    for (const left of ['priya.sharma', 'Walk In Customer', 'Paid by CASH', 'Thank you', 'HSN']) {
      expect(out).not.toContain(left);
    }
  });

  it('leaves out a paid sale’s zero balance when payments are hidden', () => {
    const template = presetTemplate('MINIMAL', '80MM');
    template.sections.payments = false;
    expect(text(template, { ...sale, due: 0 })).not.toContain('Remaining Due');
  });

  it('sums the GST summary by rate', () => {
    const out = text(presetTemplate('DETAILED', '80MM'));
    expect(out).toMatch(/GST%\s+Taxable\s+Tax/);
    expect(out).toMatch(/5%\s+930\.48\s+47\.52/);
    expect(out).toMatch(/12%\s+238\.39\s+28\.61/);
    expect(out).toMatch(/18%\s+151\.27\s+27\.23/);
    expect(out).toContain('You saved 43.50');
    // 1.5 L isn't a whole count, so only the number of items is given.
    expect(out).toContain('Items: 3');
    expect(out).not.toContain('Qty:');
  });

  it('lays compact receipts out in columns', () => {
    const lines = text(presetTemplate('COMPACT', '58MM')).split('\n');
    expect(lines).toContain('Item           Qty  Rate  Amount');
    expect(lines.some((line) => /^Notebook\s+3 +89\.00 +267\.00$/.test(line))).toBe(true);
  });

  it('prints the store name and total in large letters, half as many to a line', () => {
    const { lines } = renderReceipt(sale, presetTemplate('DETAILED', '80MM'));
    const large = lines.filter((line) => line.large);
    expect(large.map((line) => line.text.trim())).toEqual(
      expect.arrayContaining(['Everyday Market', 'TOTAL            1400.00'])
    );
  });

  it('adds a barcode of the bill number', () => {
    const { lines } = renderReceipt(sale, presetTemplate('DETAILED', '80MM'));
    expect(lines.at(-1)).toMatchObject({ barcode: 'MAI/1/26/00080' });
    const template = presetTemplate('DETAILED', '80MM');
    template.sections.barcode = false;
    expect(renderReceipt(sale, template).lines.some((line) => line.barcode)).toBe(false);
  });
});

describe('resolveReceiptTemplate', () => {
  it('falls back to classic on the paper the old CSS set', () => {
    expect(resolveReceiptTemplate(null, '#printable-invoice { --receipt-ch: 32 }')).toEqual(presetTemplate('CLASSIC', '58MM'));
    expect(resolveReceiptTemplate(null, null)).toEqual(presetTemplate('CLASSIC', '80MM'));
  });

  it('keeps what it can read of a template from a newer version', () => {
    const saved = { style: 'COMPACT', paper: '58MM_SMALL', sections: { barcode: true, logo: false, qrCode: true }, font: 'B' };
    const template = resolveReceiptTemplate(saved);
    expect(template.style).toBe('COMPACT');
    expect(template.paper).toBe('58MM_SMALL');
    expect(template.sections.barcode).toBe(true);
    expect(template.sections.logo).toBe(false);
    expect(template.sections.payments).toBe(true);
  });

  it('ignores an unknown layout', () => {
    expect(resolveReceiptTemplate({ style: 'FANCY', paper: '80MM', sections: {} }, null)).toEqual(presetTemplate('CLASSIC', '80MM'));
  });
});

describe('Code 128', () => {
  it('has 11-module symbols and a 13-module stop', () => {
    CODE128_PATTERNS.forEach((pattern, value) => {
      const modules = [...pattern].reduce((sum, width) => sum + Number(width), 0);
      expect(modules, String(value)).toBe(value === 106 ? 13 : 11);
    });
  });

  it('encodes text in set B with its checksum', () => {
    // (104 + 33×1 + 34×2 + 35×3) mod 103 = 1
    expect(code128Values('ABC')).toEqual([104, 33, 34, 35, 1, 106]);
  });

  it('packs an even run of digits in set C', () => {
    // (105 + 12×1 + 34×2) mod 103 = 82
    expect(code128Values('1234')).toEqual([105, 12, 34, 82, 106]);
  });

  it('decodes back to the same symbols', () => {
    const modules = code128Modules('MAI/1/26/00080');
    const runs = modules.match(/1+|0+/g)!.map((run) => run.length);
    const symbols: number[] = [];
    for (let i = 0; i + 6 <= runs.length; i += 6) symbols.push(CODE128_PATTERNS.indexOf(runs.slice(i, i + 6).join('')));
    expect(symbols.slice(0, -1)).toEqual(code128Values('MAI/1/26/00080').slice(0, -1));
    expect(modules.startsWith('1') && modules.endsWith('1')).toBe(true);
  });

  it('refuses text a scanner could not read back', () => {
    expect(() => code128Values('₹100')).toThrow();
  });
});
