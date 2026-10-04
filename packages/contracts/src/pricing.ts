/**
 * Line tax maths shared by the API (which decides the numbers) and the POS (which shows
 * them before checkout), so both always agree to the paisa.
 */

export type TaxMode = 'INCLUSIVE' | 'EXCLUSIVE';
/** How a bill's total is rounded: not at all, to the nearest rupee, or to the nearest 50 paise. */
export type RoundOffMode = 'NONE' | 'NEAREST_1' | 'NEAREST_050';
export type TaxCalculationMode = 'AFTER_DISCOUNT' | 'BEFORE_DISCOUNT';

/** `value` with its decimal point moved `places` places, by its decimal digits rather than binary maths. */
function shiftDecimal(value: number, places: number) {
  const [mantissa, exponent = '0'] = String(value).split('e');
  return Number(`${mantissa}e${Number(exponent) + places}`);
}

/**
 * Rounds half away from zero at `decimals` places, on the number as it is written: 1.005 is
 * 1.01 (`Math.round(1.005 * 100)` gives 100, since 1.005 × 100 is 100.49999… in binary).
 * Every amount in the app is rounded with this, so the POS, the API and GST returns agree.
 */
export function roundTo(value: number, decimals: number) {
  if (!Number.isFinite(value)) return value;
  const sign = value < 0 ? -1 : 1;
  return sign * shiftDecimal(Math.round(shiftDecimal(Math.abs(value), decimals)), -decimals) + 0;
}

/** Money: to the paisa. */
export const round2 = (value: number) => roundTo(value, 2);
/** Quantities: to three places. */
export const round3 = (value: number) => roundTo(value, 3);

/**
 * What the customer pays for one unit at `price` before any discount: with GST added for a
 * tax-exclusive price when tax is charged. This is what may never be above the MRP, which
 * includes all taxes.
 */
export function priceWithTax(price: number, taxMode: TaxMode | undefined, taxRate: number, chargeTax = true) {
  return round2(chargeTax && taxMode !== 'INCLUSIVE' && taxRate > 0 ? (price * (100 + taxRate)) / 100 : price);
}

/** Why `price` breaks its MRP (0: none printed), or null when it doesn't. */
export function mrpProblem(price: number, mrp: number, taxMode: TaxMode | undefined, taxRate: number, chargeTax = true) {
  if (!(mrp > 0)) return null;
  const charged = priceWithTax(price, taxMode, taxRate, chargeTax);
  if (charged <= round2(mrp)) return null;
  return charged === round2(price)
    ? `${charged.toFixed(2)} is above the MRP of ${round2(mrp).toFixed(2)}`
    : `${charged.toFixed(2)} with GST is above the MRP of ${round2(mrp).toFixed(2)}`;
}

/** The amount before tax for a gross line amount (the shelf price × quantity). */
export function exclusiveBase(gross: number, taxMode: TaxMode | undefined, taxRate: number) {
  return round2(taxMode === 'INCLUSIVE' && taxRate > 0 ? (gross * 100) / (100 + taxRate) : gross);
}

/**
 * Tax and net amount for one line.
 *
 * - `gross`: shelf price × quantity, as entered (tax-inclusive for INCLUSIVE lines).
 * - `baseExclusive`: `exclusiveBase(gross, ...)`, before any discount.
 * - `taxable`: `baseExclusive` minus the line's item and order discounts.
 *
 * For tax-inclusive lines the tax is what is left after the taxable amount, rather than
 * a separately rounded percentage, so taxable + tax always adds back up to the price
 * (₹100 at 18% is 84.75 + 15.25, not 84.75 + 15.26 = ₹100.01).
 */
export function lineTax(input: {
  gross: number;
  baseExclusive: number;
  taxable: number;
  taxMode: TaxMode | undefined;
  taxRate: number;
  taxCalculationMode: TaxCalculationMode;
}) {
  const { gross, baseExclusive, taxable, taxMode, taxRate, taxCalculationMode } = input;
  if (taxMode === 'INCLUSIVE' && taxRate > 0) {
    // Tax on the undiscounted price is fixed at price − base; otherwise the tax-inclusive
    // amount shrinks in proportion to the discounted base.
    const tax =
      taxCalculationMode === 'BEFORE_DISCOUNT'
        ? round2(gross - baseExclusive)
        : baseExclusive > 0
          ? round2(Math.max(0, round2((gross * taxable) / baseExclusive) - taxable))
          : 0;
    return { tax, net: round2(taxable + tax) };
  }
  const taxBase = taxCalculationMode === 'BEFORE_DISCOUNT' ? baseExclusive : taxable;
  const tax = round2((taxBase * taxRate) / 100);
  return { tax, net: round2(taxable + tax) };
}

/** A sale line's (or return line's) taxable value and tax, by kind. */
export type GstAmounts = { taxable: number; cgst: number; sgst: number; igst: number };

const GST_PARTS = ['taxable', 'cgst', 'sgst', 'igst'] as const;

/**
 * What returning `qty` more units of a sale line refunds, part by part. Each part
 * (taxable value, CGST, SGST, IGST) is prorated on the units returned so far, less what
 * earlier returns took, so the parts never exceed the line's and returning a line in any
 * number of steps adds back up to it exactly. The last units take whatever is left.
 * `amount` (the refund) is the parts' sum.
 */
export function returnLineAmounts(input: {
  line: GstAmounts;
  soldQty: number;
  alreadyReturnedQty: number;
  alreadyReturned: GstAmounts;
  qty: number;
}): GstAmounts & { tax: number; amount: number } {
  const { line, soldQty, alreadyReturnedQty, alreadyReturned, qty } = input;
  const parts: GstAmounts = { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
  if (soldQty > 0 && qty > 0) {
    const returnedQty = alreadyReturnedQty + qty;
    const isLastOfLine = Math.abs(returnedQty - soldQty) < 1e-9;
    for (const part of GST_PARTS) {
      const remaining = Math.max(0, round2(line[part] - alreadyReturned[part]));
      const target = round2((line[part] * returnedQty) / soldQty);
      parts[part] = isLastOfLine ? remaining : Math.min(remaining, Math.max(0, round2(target - alreadyReturned[part])));
    }
  }
  const tax = round2(parts.cgst + parts.sgst + parts.igst);
  return { ...parts, tax, amount: round2(parts.taxable + tax) };
}

/**
 * A line's GST split by kind. An inter-state sale is all IGST. Within a state it is half
 * CGST and half SGST: CGST is the half rounded down to the paisa and SGST the rest, so the
 * two always add up to the tax (15.25 is 7.62 + 7.63).
 */
export function splitGst(tax: number, interState: boolean) {
  if (interState) return { cgst: 0, sgst: 0, igst: round2(tax) };
  const cents = Math.round(tax * 100);
  const cgst = Math.floor(cents / 2) / 100;
  return { cgst, sgst: round2(cents / 100 - cgst), igst: 0 };
}

export type DiscountInput = { type: 'PERCENTAGE' | 'FIXED'; value: number };
export type ResolvedDiscount = DiscountInput & { amount: number };

/**
 * Amounts for a list of discounts on one base. Percentages are of the base; if together
 * they exceed the base they are scaled down to it, paisa by paisa, so they add up exactly.
 */
export function resolveDiscountAmounts(discounts: DiscountInput[] | undefined, base: number): ResolvedDiscount[] {
  const normalizedBase = round2(Math.max(0, base));
  if (normalizedBase <= 0 || !discounts || discounts.length === 0) {
    return [];
  }

  const rawDiscounts = discounts.map((discount) => ({
    type: discount.type,
    value: round2(Math.max(0, discount.value)),
    amount: round2(
      discount.type === 'PERCENTAGE' ? (normalizedBase * Math.max(0, discount.value)) / 100 : Math.max(0, discount.value)
    )
  }));

  const totalRaw = round2(rawDiscounts.reduce((acc, discount) => acc + discount.amount, 0));
  if (totalRaw <= normalizedBase) {
    return rawDiscounts;
  }

  const scale = normalizedBase / totalRaw;
  const scaled = rawDiscounts.map((discount) => ({ ...discount, amount: round2(discount.amount * scale) }));
  let scaledTotal = round2(scaled.reduce((acc, discount) => acc + discount.amount, 0));
  if (scaledTotal > normalizedBase) {
    let excessCents = Math.round(round2(scaledTotal - normalizedBase) * 100);
    const descending = scaled
      .map((discount, idx) => ({ idx, amount: discount.amount }))
      .sort((a, b) => b.amount - a.amount || a.idx - b.idx);
    while (excessCents > 0 && descending.length > 0) {
      for (const entry of descending) {
        if (excessCents <= 0) break;
        if (scaled[entry.idx].amount < 0.01) continue;
        scaled[entry.idx] = { ...scaled[entry.idx], amount: round2(scaled[entry.idx].amount - 0.01) };
        excessCents -= 1;
      }
    }
    scaledTotal = round2(scaled.reduce((acc, discount) => acc + discount.amount, 0));
  }

  let remainingCents = Math.round(round2(normalizedBase - scaledTotal) * 100);
  const fractions = rawDiscounts.map((discount, idx) => discount.amount * scale - scaled[idx].amount);
  const order = scaled
    .map((_discount, idx) => ({ idx, frac: fractions[idx] ?? 0 }))
    .sort((a, b) => b.frac - a.frac || a.idx - b.idx);
  while (remainingCents > 0 && order.length > 0) {
    for (const entry of order) {
      if (remainingCents <= 0) break;
      scaled[entry.idx] = { ...scaled[entry.idx], amount: round2(scaled[entry.idx].amount + 0.01) };
      remainingCents -= 1;
    }
  }

  return scaled;
}

/**
 * Splits one discount across lines in proportion to their bases, in whole paise: shares
 * are floored, then the leftover paise go to the largest remainders. Never gives a line
 * more than its base, and the shares add up to the (capped) discount.
 */
export function allocateDiscountAcrossBases(bases: number[], discountAmount: number): number[] {
  const totalBase = round2(bases.reduce((acc, base) => acc + base, 0));
  const cappedDiscount = round2(Math.min(Math.max(0, discountAmount), totalBase));
  if (totalBase <= 0 || cappedDiscount <= 0) {
    return new Array(bases.length).fill(0);
  }

  const rawShares = bases.map((base) => (base / totalBase) * cappedDiscount);
  const floored = rawShares.map((share) => round2(Math.floor(share * 100) / 100));
  const fractions = rawShares.map((share, idx) => share - floored[idx]);
  let remainingCents = Math.round(round2(cappedDiscount - floored.reduce((acc, share) => acc + share, 0)) * 100);

  const order = bases
    .map((base, idx) => ({ idx, frac: fractions[idx] ?? 0, headroom: round2(base - floored[idx]) }))
    .filter((entry) => entry.headroom >= 0.01)
    .sort((a, b) => b.frac - a.frac || a.idx - b.idx);

  while (remainingCents > 0 && order.length > 0) {
    let progressed = false;
    for (const entry of order) {
      if (remainingCents <= 0) break;
      if (round2(bases[entry.idx] - floored[entry.idx]) < 0.01) continue;
      floored[entry.idx] = round2(floored[entry.idx] + 0.01);
      remainingCents -= 1;
      progressed = true;
    }
    if (!progressed) break;
  }

  return floored;
}

export type PricedLineInput = {
  /** Base-unit quantity. */
  qty: number;
  /** Quantity in the sale unit, when the line is sold in one (e.g. boxes); prices are per this unit. */
  saleUomQty?: number | null;
  /** Price per pricing unit, tax-inclusive for INCLUSIVE lines. */
  rate: number;
  taxRate: number;
  taxMode?: TaxMode;
  discounts?: DiscountInput[];
};

/**
 * The whole sale: each line's gross, pre-tax base, item discounts, share of the order
 * discounts, taxable amount, tax and net, plus the totals. The API saves exactly this, and
 * the POS shows it computed from the same request, so the two always agree.
 */
export function computeSaleTotals<L extends PricedLineInput>(
  lines: L[],
  orderDiscounts: DiscountInput[] | undefined,
  taxCalculationMode: TaxCalculationMode,
  options: {
    /**
     * False when the seller may not charge GST (a composition taxpayer): every line is
     * priced as untaxed, so the customer pays the shelf price less discounts and the tax
     * is 0. The returned lines say so (taxRate 0, EXCLUSIVE).
     */
    chargeTax?: boolean;
    /** True when the goods go to another state (IGST); otherwise the tax is CGST + SGST. */
    interState?: boolean;
    /** Rounds the bill's total (see roundOffFor); lines, taxable values and GST stay as they are. */
    roundOff?: RoundOffMode;
  } = {}
) {
  const pricedLines =
    options.chargeTax === false ? lines.map((line) => ({ ...line, taxRate: 0, taxMode: 'EXCLUSIVE' as const })) : lines;
  const normalized = pricedLines.map((line) => {
    const gross = round2((line.saleUomQty ?? line.qty) * line.rate);
    const baseExclusive = exclusiveBase(gross, line.taxMode, line.taxRate);
    const itemDiscounts = resolveDiscountAmounts(line.discounts, baseExclusive);
    const itemDiscount = round2(itemDiscounts.reduce((acc, discount) => acc + discount.amount, 0));
    const baseAfterItem = round2(Math.max(0, baseExclusive - itemDiscount));
    return { line, gross, baseExclusive, itemDiscounts, itemDiscount, baseAfterItem };
  });

  const bases = normalized.map((entry) => entry.baseAfterItem);
  const orderDiscountBase = round2(bases.reduce((acc, base) => acc + base, 0));
  const orderDiscountPlans = resolveDiscountAmounts(orderDiscounts, orderDiscountBase).map((discount) => ({
    ...discount,
    allocations: allocateDiscountAcrossBases(bases, discount.amount)
  }));

  const computed = normalized.map((entry, idx) => {
    const orderDiscount = round2(orderDiscountPlans.reduce((acc, plan) => acc + (plan.allocations[idx] ?? 0), 0));
    const discountAmount = round2(entry.itemDiscount + orderDiscount);
    const taxable = round2(Math.max(0, entry.baseExclusive - discountAmount));
    const { tax, net } = lineTax({
      gross: entry.gross,
      baseExclusive: entry.baseExclusive,
      taxable,
      taxMode: entry.line.taxMode,
      taxRate: entry.line.taxRate,
      taxCalculationMode
    });
    return { ...entry, orderDiscount, discountAmount, taxable, tax, ...splitGst(tax, options.interState === true), net };
  });

  const sum = (pick: (line: (typeof computed)[number]) => number) => round2(computed.reduce((acc, line) => acc + pick(line), 0));
  return {
    lines: computed,
    orderDiscountPlans,
    /** Pre-tax amount after item discounts: what an order discount applies to. */
    orderDiscountBase,
    subTotal: sum((line) => line.baseExclusive),
    discountTotal: sum((line) => line.discountAmount),
    orderDiscountTotal: sum((line) => line.orderDiscount),
    taxTotal: sum((line) => line.tax),
    cgstTotal: sum((line) => line.cgst),
    sgstTotal: sum((line) => line.sgst),
    igstTotal: sum((line) => line.igst),
    ...roundedTotal(sum((line) => line.net), options.roundOff ?? 'NONE')
  };
}

/**
 * What a bill's total is rounded by: to the nearest rupee or 50 paise, halves up (₹486.50 is
 * ₹487). Between −0.50 and +0.50 (−0.25 and +0.25 for 50 paise).
 */
export function roundOffFor(total: number, mode: RoundOffMode) {
  const step = mode === 'NEAREST_1' ? 1 : mode === 'NEAREST_050' ? 0.5 : 0;
  if (step === 0 || total <= 0) return 0;
  return round2(Math.round(round2(total / step) + 1e-9) * step - total);
}

/** A bill's total before and after rounding: `grandTotal` = `netTotal` + `roundOff`. */
export function roundedTotal(netTotal: number, mode: RoundOffMode) {
  const roundOff = roundOffFor(netTotal, mode);
  return { netTotal, roundOff, grandTotal: round2(netTotal + roundOff) };
}
