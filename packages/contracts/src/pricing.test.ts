import { describe, expect, it } from 'vitest';
import {
  allocateDiscountAcrossBases,
  computeSaleTotals,
  exclusiveBase,
  lineTax,
  resolveDiscountAmounts,
  returnLineRefund,
  splitGst,
  type PricedLineInput
} from './pricing.js';

const round2 = (v: number) => Math.round(v * 100) / 100;
const sum = (values: number[]) => round2(values.reduce((a, b) => a + b, 0));

describe('lineTax', () => {
  it('keeps a tax-inclusive ₹100 at 18% at ₹100.00 (not 84.75 + 15.26 = 100.01)', () => {
    const base = exclusiveBase(100, 'INCLUSIVE', 18);
    expect(base).toBe(84.75);
    expect(lineTax({ gross: 100, baseExclusive: base, taxable: base, taxMode: 'INCLUSIVE', taxRate: 18, taxCalculationMode: 'AFTER_DISCOUNT' }))
      .toEqual({ tax: 15.25, net: 100 });
  });

  it('adds tax on top for tax-exclusive prices', () => {
    expect(lineTax({ gross: 100, baseExclusive: 100, taxable: 100, taxMode: 'EXCLUSIVE', taxRate: 18, taxCalculationMode: 'AFTER_DISCOUNT' }))
      .toEqual({ tax: 18, net: 118 });
  });

  it('never moves an undiscounted tax-inclusive line off its shelf price', () => {
    for (const rate of [0.25, 3, 5, 12, 18, 28]) {
      for (let paise = 1; paise <= 20000; paise += 7) {
        const gross = paise / 100;
        const base = exclusiveBase(gross, 'INCLUSIVE', rate);
        for (const mode of ['AFTER_DISCOUNT', 'BEFORE_DISCOUNT'] as const) {
          const { tax, net } = lineTax({ gross, baseExclusive: base, taxable: base, taxMode: 'INCLUSIVE', taxRate: rate, taxCalculationMode: mode });
          expect(net).toBe(gross);
          expect(tax).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('BEFORE_DISCOUNT keeps the tax of the undiscounted price', () => {
    // ₹118 incl. 18%: base 100, tax 18. A ₹10 discount leaves taxable 90 but tax stays 18.
    expect(lineTax({ gross: 118, baseExclusive: 100, taxable: 90, taxMode: 'INCLUSIVE', taxRate: 18, taxCalculationMode: 'BEFORE_DISCOUNT' }))
      .toEqual({ tax: 18, net: 108 });
    expect(lineTax({ gross: 100, baseExclusive: 100, taxable: 90, taxMode: 'EXCLUSIVE', taxRate: 18, taxCalculationMode: 'BEFORE_DISCOUNT' }))
      .toEqual({ tax: 18, net: 108 });
  });
});

describe('resolveDiscountAmounts', () => {
  it('applies several discounts to one base', () => {
    expect(resolveDiscountAmounts([{ type: 'PERCENTAGE', value: 10 }, { type: 'FIXED', value: 5 }], 200).map((d) => d.amount)).toEqual([20, 5]);
  });

  it('scales discounts that exceed the base so they add up to exactly the base', () => {
    const amounts = resolveDiscountAmounts(
      [{ type: 'PERCENTAGE', value: 70 }, { type: 'FIXED', value: 50 }, { type: 'FIXED', value: 33.33 }],
      100
    ).map((d) => d.amount);
    expect(sum(amounts)).toBe(100);
    amounts.forEach((amount) => expect(amount).toBeGreaterThanOrEqual(0));
  });

  it('ignores discounts on a zero base', () => {
    expect(resolveDiscountAmounts([{ type: 'FIXED', value: 10 }], 0)).toEqual([]);
  });
});

describe('allocateDiscountAcrossBases', () => {
  it('splits in whole paise that add up to the discount', () => {
    const shares = allocateDiscountAcrossBases([33.33, 33.33, 33.34], 10);
    expect(sum(shares)).toBe(10);
    shares.forEach((share) => expect(Math.round(share * 100)).toBe(share * 100));
  });

  it('never gives a line more than its base and caps at the total', () => {
    const bases = [0.01, 5, 1000];
    const shares = allocateDiscountAcrossBases(bases, 5000);
    expect(sum(shares)).toBe(1005.01);
    shares.forEach((share, i) => expect(share).toBeLessThanOrEqual(bases[i]));
  });
});

describe('computeSaleTotals', () => {
  it('prices a sale unit (1 box of 10) at the box price', () => {
    const totals = computeSaleTotals([{ qty: 10, saleUomQty: 1, rate: 45000, taxRate: 18, taxMode: 'EXCLUSIVE' }], [], 'AFTER_DISCOUNT');
    expect(totals.lines[0].gross).toBe(45000);
    expect(totals.grandTotal).toBe(53100);
  });

  it('applies item discounts, then splits the order discount over what is left', () => {
    const totals = computeSaleTotals(
      [
        { qty: 2, rate: 100, taxRate: 18, taxMode: 'EXCLUSIVE', discounts: [{ type: 'FIXED', value: 20 }] },
        { qty: 1, rate: 118, taxRate: 18, taxMode: 'INCLUSIVE' }
      ],
      [{ type: 'PERCENTAGE', value: 10 }],
      'AFTER_DISCOUNT'
    );
    expect(totals.orderDiscountBase).toBe(280); // (200 − 20) + 100
    expect(totals.orderDiscountTotal).toBe(28);
    expect(totals.lines.map((l) => l.orderDiscount)).toEqual([18, 10]);
    expect(totals.lines.map((l) => l.taxable)).toEqual([162, 90]);
    expect(totals.grandTotal).toBe(sum(totals.lines.map((l) => l.net)));
    expect(totals.grandTotal).toBe(297.36); // 162 × 1.18 + 118 × 90/100
  });

  it('charges no tax for a composition taxpayer: the customer pays the shelf price', () => {
    const lines = [
      { qty: 2, rate: 100, taxRate: 18, taxMode: 'EXCLUSIVE' as const, discounts: [{ type: 'FIXED' as const, value: 20 }] },
      { qty: 1, rate: 118, taxRate: 18, taxMode: 'INCLUSIVE' as const }
    ];
    const totals = computeSaleTotals(lines, [{ type: 'PERCENTAGE', value: 10 }], 'AFTER_DISCOUNT', { chargeTax: false });
    expect(totals.taxTotal).toBe(0);
    expect(totals.lines.map((l) => l.baseExclusive)).toEqual([200, 118]); // nothing taken out of the inclusive price
    expect(totals.orderDiscountTotal).toBe(29.8); // 10% of (200 − 20) + 118
    expect(totals.grandTotal).toBe(268.2); // 180 + 118 − 29.80
    expect(totals.lines.map((l) => [l.line.taxRate, l.line.taxMode])).toEqual([[0, 'EXCLUSIVE'], [0, 'EXCLUSIVE']]);
    expect(lines[0].taxRate).toBe(18); // the caller's lines are left alone
  });

  it('charges tax unless told not to', () => {
    const line = { qty: 1, rate: 100, taxRate: 18, taxMode: 'EXCLUSIVE' as const };
    expect(computeSaleTotals([line], [], 'AFTER_DISCOUNT').grandTotal).toBe(118);
    expect(computeSaleTotals([line], [], 'AFTER_DISCOUNT', { chargeTax: true }).grandTotal).toBe(118);
  });

  it('keeps its invariants on random carts', () => {
    let seed = 42;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const money = (max: number) => round2(rnd() * max);
    for (let i = 0; i < 3000; i++) {
      const lines: PricedLineInput[] = Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => ({
        qty: 1 + Math.floor(rnd() * 9),
        rate: money(2000),
        taxRate: [0, 5, 12, 18, 28][Math.floor(rnd() * 5)],
        taxMode: rnd() < 0.5 ? 'INCLUSIVE' : 'EXCLUSIVE',
        discounts: rnd() < 0.5 ? [{ type: 'FIXED', value: money(300) }] : []
      }));
      const orderDiscounts = rnd() < 0.5 ? [{ type: 'PERCENTAGE' as const, value: money(100) }] : [];
      const mode = rnd() < 0.5 ? 'AFTER_DISCOUNT' : 'BEFORE_DISCOUNT';
      const totals = computeSaleTotals(lines, orderDiscounts, mode);
      for (const plan of totals.orderDiscountPlans) expect(sum(plan.allocations)).toBe(plan.amount);
      for (const line of totals.lines) {
        expect(line.discountAmount).toBeLessThanOrEqual(line.baseExclusive);
        expect(line.taxable).toBeGreaterThanOrEqual(0);
        expect(line.net).toBeGreaterThanOrEqual(line.taxable);
        if (line.discountAmount === 0 && line.line.taxMode === 'INCLUSIVE') expect(line.net).toBe(line.gross);
        expect(round2(line.cgst + line.sgst + line.igst)).toBe(line.tax);
      }
      expect(round2(totals.cgstTotal + totals.sgstTotal + totals.igstTotal)).toBe(totals.taxTotal);
      expect(totals.grandTotal).toBe(sum(totals.lines.map((l) => l.net)));
    }
  });
});

describe('splitGst', () => {
  it('splits intra-state tax into CGST and SGST that add up, SGST taking the odd paisa', () => {
    expect(splitGst(15.25, false)).toEqual({ cgst: 7.62, sgst: 7.63, igst: 0 });
    expect(splitGst(36, false)).toEqual({ cgst: 18, sgst: 18, igst: 0 });
    expect(splitGst(0.01, false)).toEqual({ cgst: 0, sgst: 0.01, igst: 0 });
    expect(splitGst(0, false)).toEqual({ cgst: 0, sgst: 0, igst: 0 });
  });

  it('makes inter-state tax all IGST', () => {
    expect(splitGst(15.25, true)).toEqual({ cgst: 0, sgst: 0, igst: 15.25 });
  });

  it('always adds back up to the tax', () => {
    for (let cents = 0; cents < 100000; cents += 7) {
      const tax = cents / 100;
      const { cgst, sgst } = splitGst(tax, false);
      expect(round2(cgst + sgst)).toBe(tax);
      expect(Math.abs(cgst - sgst)).toBeLessThanOrEqual(0.01 + 1e-9);
    }
  });
});

describe('computeSaleTotals tax split', () => {
  const lines: PricedLineInput[] = [
    { qty: 1, rate: 100, taxRate: 18, taxMode: 'INCLUSIVE' }, // tax 15.25
    { qty: 3, rate: 33.33, taxRate: 5, taxMode: 'EXCLUSIVE' } // tax 5.00
  ];

  it('gives each line and the sale its CGST and SGST within a state', () => {
    const totals = computeSaleTotals(lines, [], 'AFTER_DISCOUNT');
    expect(totals.lines.map((l) => [l.cgst, l.sgst, l.igst])).toEqual([[7.62, 7.63, 0], [2.5, 2.5, 0]]);
    expect([totals.cgstTotal, totals.sgstTotal, totals.igstTotal]).toEqual([10.12, 10.13, 0]);
    expect(round2(totals.cgstTotal + totals.sgstTotal)).toBe(totals.taxTotal);
  });

  it('makes it all IGST between states, and nothing for a composition taxpayer', () => {
    const inter = computeSaleTotals(lines, [], 'AFTER_DISCOUNT', { interState: true });
    expect([inter.cgstTotal, inter.sgstTotal, inter.igstTotal]).toEqual([0, 0, inter.taxTotal]);
    const composition = computeSaleTotals(lines, [], 'AFTER_DISCOUNT', { chargeTax: false });
    expect([composition.cgstTotal, composition.sgstTotal, composition.igstTotal]).toEqual([0, 0, 0]);
  });
});

describe('returnLineRefund', () => {
  it('refunds a ₹200 line of 3 one unit at a time as 66.67 + 66.67 + 66.66', () => {
    const refunds: number[] = [];
    for (let returned = 0; returned < 3; returned++) {
      refunds.push(returnLineRefund({ lineNet: 200, soldQty: 3, alreadyReturnedQty: returned, alreadyRefunded: sum(refunds), qty: 1 }));
    }
    expect(refunds).toEqual([66.67, 66.67, 66.66]);
  });

  it('gives the last unit whatever is left', () => {
    const first = returnLineRefund({ lineNet: 200, soldQty: 3, alreadyReturnedQty: 0, alreadyRefunded: 0, qty: 2 });
    const last = returnLineRefund({ lineNet: 200, soldQty: 3, alreadyReturnedQty: 2, alreadyRefunded: first, qty: 1 });
    expect([first, last]).toEqual([133.33, 66.67]);
  });
});
