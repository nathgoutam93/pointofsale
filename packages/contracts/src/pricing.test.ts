import { describe, expect, it } from 'vitest';
import {
  allocateDiscountAcrossBases,
  computeSaleTotals,
  exclusiveBase,
  mrpProblem,
  priceWithTax,
  lineTax,
  resolveDiscountAmounts,
  returnLineAmounts,
  round2,
  round3,
  roundOffFor,
  roundTo,
  splitGst,
  type GstAmounts,
  type PricedLineInput
} from './pricing.js';

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

describe('returnLineAmounts', () => {
  const zero: GstAmounts = { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
  const add = (a: GstAmounts, b: GstAmounts): GstAmounts => ({
    taxable: round2(a.taxable + b.taxable),
    cgst: round2(a.cgst + b.cgst),
    sgst: round2(a.sgst + b.sgst),
    igst: round2(a.igst + b.igst)
  });
  /** Returns `steps` of a line one after another; the refunds and the running totals. */
  function returnInSteps(line: GstAmounts, soldQty: number, steps: number[]) {
    let returnedQty = 0;
    let returned = zero;
    const refunds = steps.map((qty) => {
      const result = returnLineAmounts({ line, soldQty, alreadyReturnedQty: returnedQty, alreadyReturned: returned, qty });
      returnedQty += qty;
      returned = add(returned, result);
      return result;
    });
    return { refunds, returned };
  }

  it('refunds a ₹200 line of 3 one unit at a time, adding up to 200', () => {
    const { refunds } = returnInSteps({ ...zero, taxable: 200 }, 3, [1, 1, 1]);
    expect(refunds.map((r) => r.amount)).toEqual([66.67, 66.66, 66.67]);
  });

  it('splits the refund into taxable value and tax the way the line was', () => {
    // ₹100 including 18%: 84.75 + CGST 7.62 + SGST 7.63, sold as 2 units.
    const line = { taxable: 84.75, cgst: 7.62, sgst: 7.63, igst: 0 };
    const [first, second] = returnInSteps(line, 2, [1, 1]).refunds;
    expect(first).toEqual({ taxable: 42.38, cgst: 3.81, sgst: 3.82, igst: 0, tax: 7.63, amount: 50.01 });
    expect(second).toEqual({ taxable: 42.37, cgst: 3.81, sgst: 3.81, igst: 0, tax: 7.62, amount: 49.99 });
  });

  it('never lets a part run past the line (four returns of a 0.04 tax)', () => {
    const line = { taxable: 4, cgst: 0.02, sgst: 0.02, igst: 0 };
    const { refunds, returned } = returnInSteps(line, 4, [1, 1, 1, 1]);
    expect(returned).toEqual(line);
    for (const refund of refunds) expect(refund.cgst >= 0 && refund.sgst >= 0).toBe(true);
  });

  it('keeps its invariants over random partial returns', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 3000; i++) {
      const soldQty = 1 + Math.floor(rnd() * 12);
      const taxable = round2(rnd() * 5000);
      const tax = round2((taxable * [0, 5, 12, 18, 28][Math.floor(rnd() * 5)]) / 100);
      const line = { taxable, ...splitGst(tax, rnd() < 0.3) };
      const steps: number[] = [];
      for (let left = soldQty; left > 0; ) {
        const step = 1 + Math.floor(rnd() * left);
        steps.push(step);
        left -= step;
      }
      let returned = zero;
      let returnedQty = 0;
      for (const qty of steps) {
        const r = returnLineAmounts({ line, soldQty, alreadyReturnedQty: returnedQty, alreadyReturned: returned, qty });
        for (const part of ['taxable', 'cgst', 'sgst', 'igst'] as const) expect(r[part]).toBeGreaterThanOrEqual(0);
        expect(r.amount).toBe(round2(r.taxable + r.tax));
        returnedQty += qty;
        returned = add(returned, r);
        for (const part of ['taxable', 'cgst', 'sgst', 'igst'] as const) expect(returned[part]).toBeLessThanOrEqual(line[part]);
      }
      expect(returned).toEqual(line);
    }
  });

  it('refunds nothing for nothing', () => {
    expect(returnLineAmounts({ line: { ...zero, taxable: 10 }, soldQty: 1, alreadyReturnedQty: 0, alreadyReturned: zero, qty: 0 }).amount).toBe(0);
  });
});

describe('MRP', () => {
  it('compares what the customer pays (with GST on a tax-exclusive price) with the MRP', () => {
    expect(priceWithTax(100, 'EXCLUSIVE', 18)).toBe(118);
    expect(priceWithTax(100, 'INCLUSIVE', 18)).toBe(100);
    expect(priceWithTax(100, 'EXCLUSIVE', 18, false)).toBe(100); // composition: no GST charged
    expect(mrpProblem(100, 118, 'EXCLUSIVE', 18)).toBeNull();
    expect(mrpProblem(100, 117.99, 'EXCLUSIVE', 18)).toBe('118.00 with GST is above the MRP of 117.99');
    expect(mrpProblem(119, 118, 'INCLUSIVE', 18)).toBe('119.00 is above the MRP of 118.00');
    expect(mrpProblem(1000, 0, 'EXCLUSIVE', 18)).toBeNull(); // no MRP printed
  });
});

describe('rounding', () => {
  it('rounds half away from zero on the number as written', () => {
    expect(round2(1.005)).toBe(1.01); // Math.round(1.005 * 100) / 100 gives 1
    expect(round2(-1.005)).toBe(-1.01);
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(1234.005)).toBe(1234.01);
    expect(round2(1e-7)).toBe(0);
    expect(Object.is(round2(-0.001), 0)).toBe(true);
    expect(round3(2.0005)).toBe(2.001);
    expect(roundTo(123456789.125, 2)).toBe(123456789.13);
  });
});

describe('round-off', () => {
  it('rounds the total to the rupee or 50 paise, halves up, leaving lines and GST alone', () => {
    expect(roundOffFor(486.6, 'NEAREST_1')).toBe(0.4);
    expect(roundOffFor(486.5, 'NEAREST_1')).toBe(0.5);
    expect(roundOffFor(486.49, 'NEAREST_1')).toBe(-0.49);
    expect(roundOffFor(486.24, 'NEAREST_050')).toBe(-0.24);
    expect(roundOffFor(486.25, 'NEAREST_050')).toBe(0.25);
    expect(roundOffFor(486.6, 'NONE')).toBe(0);
    const totals = computeSaleTotals([{ qty: 1, rate: 412.37, taxRate: 18, taxMode: 'EXCLUSIVE' }], [], 'AFTER_DISCOUNT', { roundOff: 'NEAREST_1' });
    expect(totals.netTotal).toBe(486.6);
    expect(totals).toMatchObject({ roundOff: 0.4, grandTotal: 487, taxTotal: 74.23 });
    expect(totals.lines[0].net).toBe(486.6);
  });
});
