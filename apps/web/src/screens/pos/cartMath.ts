import { exclusiveBase, lineTax } from "@pos/contracts";
import type { CartLine } from "./types";

export type TaxCalculationMode = "AFTER_DISCOUNT" | "BEFORE_DISCOUNT";

// Pure helpers for cart lines: rounding, quantities and per-line amounts.

export function round2(value: number) {
  return Math.round(value * 100) / 100;
}

export function round3(value: number) {
  return Math.round(value * 1000) / 1000;
}

export function normalizeLeastCount(value: number | string | null | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  const rounded = round3(parsed);
  return rounded >= 0.001 ? rounded : 1;
}

export function getQtyDecimals(leastCount: number) {
  const normalized = normalizeLeastCount(leastCount);
  const asText = normalized.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  const decimals = asText.includes(".") ? asText.split(".")[1].length : 0;
  return Math.min(3, Math.max(0, decimals));
}

export function formatQty(qty: number, leastCount: number) {
  const decimals = getQtyDecimals(leastCount);
  return qty.toFixed(decimals);
}

export function formatStockOnHand(qty: number) {
  return round3(qty).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

export function getPricingQty(line: Pick<CartLine, "qty" | "saleUomQty">) {
  return line.saleUomQty ?? line.qty;
}

/**
 * The line as it is priced. A seller that can't charge GST (a composition taxpayer)
 * prices every line untaxed, the same as computeSaleTotals with chargeTax false. Cart
 * lines keep the item's real rate, which checkout sends and the server checks.
 */
function asPriced<T extends Pick<CartLine, "taxRate" | "taxMode">>(line: T, chargeTax: boolean): T {
  return chargeTax ? line : { ...line, taxRate: 0, taxMode: "EXCLUSIVE" };
}

/** The line's price before tax and discounts. `chargeTax` false: the whole price (no tax in it). */
export function getBaseExclusive(
  line: Pick<CartLine, "qty" | "rate" | "taxRate" | "taxMode" | "saleUomQty">,
  chargeTax = true,
) {
  const priced = asPriced(line, chargeTax);
  const gross = round2(getPricingQty(priced) * priced.rate);
  return exclusiveBase(gross, priced.taxMode, priced.taxRate);
}

export const snapQtyToLeastCount = (qty: number, leastCount: number) => {
  const unit = normalizeLeastCount(leastCount);
  const steps = Math.round(qty / unit);
  return round3(Math.max(unit, steps * unit));
};

export function computeLineAmounts(
  line: Pick<
    CartLine,
    "qty" | "rate" | "discountAmount" | "taxRate" | "taxMode" | "saleUomQty"
  >,
  taxCalculationMode: TaxCalculationMode,
  chargeTax = true,
) {
  const priced = asPriced(line, chargeTax);
  const gross = round2(getPricingQty(priced) * priced.rate);
  const baseExclusive = getBaseExclusive(priced);
  const discountAmount = round2(Math.min(Math.max(0, priced.discountAmount), baseExclusive));
  const taxable = round2(Math.max(0, baseExclusive - discountAmount));
  const { tax, net } = lineTax({
    gross,
    baseExclusive,
    taxable,
    taxMode: priced.taxMode,
    taxRate: priced.taxRate,
    taxCalculationMode,
  });
  return { taxable, tax, net };
}

export const getCartLineKey = (line: Pick<CartLine, "cartKey" | "itemId" | "saleUom">) =>
  line.cartKey || `${line.itemId}:${line.saleUom ?? "BASE"}`;

export const getDiscountPercent = (line: CartLine, chargeTax = true) => {
  const baseExclusive = getBaseExclusive(line, chargeTax);
  if (baseExclusive <= 0) return 0;
  return (line.discountAmount / baseExclusive) * 100;
};

export const formatPercentValue = (value: number) => {
  if (!Number.isFinite(value)) return "0";
  const fixed = value.toFixed(2);
  return fixed.replace(/\.?0+$/, "");
};

export const formatDraftSavedAt = (savedAt: string) => {
  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) return "Saved locally";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

/** The line one step up or down (one sale unit, or the least count); never below one step. */
export function stepLineQty(line: CartLine, direction: 1 | -1): CartLine {
  const step = normalizeLeastCount(line.saleUomConversionQty ?? line.leastCount);
  if (direction === 1) {
    return {
      ...line,
      saleUomQty: line.saleUomQty === undefined ? undefined : line.saleUomQty + 1,
      qty: round3(line.qty + step),
    };
  }
  return {
    ...line,
    saleUomQty: line.saleUomQty === undefined ? undefined : Math.max(1, line.saleUomQty - 1),
    qty: round3(Math.max(step, line.qty - step)),
  };
}
