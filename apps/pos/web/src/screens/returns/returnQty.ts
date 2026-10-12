import { round3 } from "@pos/contracts";

// Pure helpers for the Returns screen: quantities in steps of an item's least count.

export const normalizeLeastCount = (value: number | string | null | undefined) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  const rounded = round3(parsed);
  return rounded >= 0.001 ? rounded : 1;
};

export const leastCountStepText = (leastCount: number) =>
  normalizeLeastCount(leastCount).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");

export const formatQty = (qty: number, leastCount: number) => {
  const normalized = normalizeLeastCount(leastCount);
  const stepText = leastCountStepText(normalized);
  const decimals = stepText.includes(".") ? stepText.split(".")[1].length : 0;
  return qty.toFixed(decimals);
};

export const formatReceiptQty = (qty: number) =>
  qty.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");

export const isMultipleOfLeastCount = (qty: number, leastCount: number) => {
  const normalizedQty = round3(qty);
  const normalizedLeastCount = normalizeLeastCount(leastCount);
  const quotient = normalizedQty / normalizedLeastCount;
  return Math.abs(quotient - Math.round(quotient)) <= 1e-6;
};
