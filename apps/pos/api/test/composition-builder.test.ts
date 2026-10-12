import { describe, expect, it } from 'vitest';
import { buildComposition, compositionTurnoverLimit } from '../src/gst/composition';
import type { Gstr1Invoice, Gstr1Line, Gstr1Return } from '../src/gst/gstr1';

// GST #39: composition figures (CMP-08, GSTR-4) on hand-made invoices.
const line = (taxable: number, supplyType: Gstr1Line['supplyType'] = 'TAXABLE'): Gstr1Line => ({
  itemName: 'Item',
  hsnCode: '1006',
  uqc: 'NOS',
  supplyType,
  taxRate: 0,
  qty: 1,
  taxable,
  cgst: 0,
  sgst: 0,
  igst: 0
});
let n = 0;
const invoice = (lines: Gstr1Line[], o: Partial<Gstr1Invoice> = {}): Gstr1Invoice => ({
  invoiceNo: `C/2627/${String(++n).padStart(5, '0')}`,
  documentSeries: 'C',
  createdAt: new Date(Date.UTC(2026, 9, 5, 6)),
  cancelled: false,
  taxpayerType: 'COMPOSITION',
  compositionCategory: 'TRADER',
  sellerGstin: '29ABCDE1234F1ZW',
  sellerStateCode: '29',
  placeOfSupplyStateCode: '29',
  grandTotal: lines.reduce((acc, l) => acc + l.taxable, 0),
  lines,
  ...o
});
const build = (invoices: Gstr1Invoice[], returns: Gstr1Return[] = [], extra: Partial<Parameters<typeof buildComposition>[0]> = {}) =>
  buildComposition({ invoices, returns, yearTurnover: 0, currentCategory: 'TRADER', ...extra });

describe('composition figures', () => {
  it('taxes a trader on taxable supplies only, at 1% split CGST and SGST', () => {
    const { rows, totals } = build([invoice([line(1000), line(200, 'EXEMPT')])]);
    expect(rows).toEqual([{ category: 'TRADER', rate: 1, turnover: 1200, taxableTurnover: 1000, taxBase: 1000, cgst: 5, sgst: 5 }]);
    expect(totals).toEqual({ turnover: 1200, taxBase: 1000, cgst: 5, sgst: 5 });
  });

  it('taxes a restaurant on all its turnover at 5%, and splits odd paise like an invoice', () => {
    const { rows } = build([invoice([line(1999.8), line(0.2, 'EXEMPT')], { compositionCategory: 'RESTAURANT' })]);
    expect(rows[0]).toMatchObject({ category: 'RESTAURANT', rate: 5, turnover: 2000, taxBase: 2000, cgst: 50, sgst: 50 });
    const trader = build([invoice([line(1001)])]).rows[0];
    expect([trader.cgst, trader.sgst]).toEqual([5, 5.01]);
  });

  it('nets returns, and leaves out cancelled and regular sales (with a warning for regular ones)', () => {
    const sale = invoice([line(1000)]);
    const returns: Gstr1Return[] = [
      { returnNo: 'CR/2627/00001', documentSeries: 'CR', createdAt: sale.createdAt, totalAmount: 400, invoice: sale, lines: [{ saleLine: sale.lines[0], qty: 1, taxable: 400, cgst: 0, sgst: 0, igst: 0 }] }
    ];
    const { totals, problems } = build(
      [sale, invoice([line(500)], { cancelled: true }), invoice([line(700)], { taxpayerType: 'REGULAR', compositionCategory: null })],
      returns
    );
    expect(totals).toEqual({ turnover: 600, taxBase: 600, cgst: 3, sgst: 3 });
    expect(problems[0].message).toMatch(/1 sale\(s\) made as a regular taxpayer are left out/);
  });

  it('warns as the year’s turnover nears the limit, and errors past it', () => {
    expect(compositionTurnoverLimit('TRADER')).toBe(15_000_000);
    expect(compositionTurnoverLimit('SERVICES')).toBe(5_000_000);
    const messages = (yearTurnover: number, currentCategory: 'TRADER' | 'SERVICES' | null = 'TRADER') =>
      build([], [], { yearTurnover, currentCategory }).problems.map((p) => `${p.severity}: ${p.message}`).join(' | ');
    expect(messages(11_000_000)).not.toMatch(/limit/);
    expect(messages(13_000_000)).toMatch(/warning: Turnover this financial year is ₹1,30,00,000, 87% of the ₹1,50,00,000 composition limit/);
    expect(messages(16_000_000)).toMatch(/error: Turnover this financial year is ₹1,60,00,000, above the ₹1,50,00,000 composition limit/);
    expect(messages(4_500_000, 'SERVICES')).toMatch(/90% of the ₹50,00,000 composition limit/);
    expect(messages(99_000_000, null)).not.toMatch(/limit/); // no longer composition
  });

  it('splits a year into its four quarters for GSTR-4', () => {
    const at = (month: number) => new Date(Date.UTC(month <= 3 ? 2027 : 2026, month - 1, 10, 6));
    const quarterOf = (date: Date) => Math.floor(((date.getUTCMonth() + 1 + 8) % 12) / 3) + 1;
    const { byQuarter, totals } = build(
      [invoice([line(100)], { createdAt: at(4) }), invoice([line(300)], { createdAt: at(11) }), invoice([line(500)], { createdAt: at(2) })],
      [],
      { quarterOf }
    );
    expect(byQuarter?.map((q) => [q.quarter, q.turnover])).toEqual([[1, 100], [2, 0], [3, 300], [4, 500]]);
    expect(totals.turnover).toBe(900);
  });
});
