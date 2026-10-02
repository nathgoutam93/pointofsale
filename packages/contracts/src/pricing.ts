/**
 * Line tax maths shared by the API (which decides the numbers) and the POS (which shows
 * them before checkout), so both always agree to the paisa.
 */

export type TaxMode = 'INCLUSIVE' | 'EXCLUSIVE';
export type TaxCalculationMode = 'AFTER_DISCOUNT' | 'BEFORE_DISCOUNT';

export const round2 = (value: number) => Math.round(value * 100) / 100;

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

/**
 * Refund for returning `qty` units of a sale line. Prorated from the line total (not a
 * rounded unit price), and the last units refund exactly what is left, so returning a
 * line in parts always adds up to what was charged for it.
 */
export function returnLineRefund(input: {
  lineNet: number;
  soldQty: number;
  alreadyReturnedQty: number;
  alreadyRefunded: number;
  qty: number;
}) {
  const { lineNet, soldQty, alreadyReturnedQty, alreadyRefunded, qty } = input;
  if (soldQty <= 0 || qty <= 0) return 0;
  const remaining = round2(Math.max(0, lineNet - alreadyRefunded));
  const isLastOfLine = Math.abs(alreadyReturnedQty + qty - soldQty) < 1e-9;
  return isLastOfLine ? remaining : round2(Math.min((lineNet * qty) / soldQty, remaining));
}
