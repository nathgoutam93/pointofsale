import { z } from 'zod';
import { round2, round3 } from './pricing.js';

/**
 * How a weighing scale prints its labels: an EAN-13-style number of digits made of a prefix
 * (which marks it as a scale label, often 2 or 21-29), the item's code on the scale (its PLU),
 * the weight or the price, and a check digit. For example 2 | 01234 | 01250 | 7 with prefix "2",
 * 5 item digits and a 5-digit weight in grams is item 1234, 1.250 kg.
 */
export const scaleBarcodeSchema = z
  .object({
    prefix: z.string().regex(/^\d{1,3}$/, 'Use 1 to 3 digits'),
    itemDigits: z.number().int().min(3).max(7),
    /** WEIGHT: the quantity in the item's unit; PRICE: the amount in rupees. */
    valueType: z.enum(['WEIGHT', 'PRICE']),
    valueDigits: z.number().int().min(3).max(7),
    /** Places after the decimal point in the value: 3 for grams as kg, 2 for paise as rupees. */
    valueDecimals: z.number().int().min(0).max(3)
  })
  .refine((config) => config.prefix.length + config.itemDigits + config.valueDigits + 1 <= 13, {
    message: 'Prefix, item and value digits and the check digit come to at most 13'
  });
export type ScaleBarcode = z.infer<typeof scaleBarcodeSchema>;

/** Whether a barcode's last digit is the EAN/UPC check digit of the rest. */
export function hasValidCheckDigit(code: string) {
  if (!/^\d{2,}$/.test(code)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  // From the right of the body: weights 3, 1, 3, 1...
  const sum = digits.reverse().reduce((acc, digit, index) => acc + digit * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/**
 * Reads a scale label, or null when `code` isn't one: the item's code on the scale (leading
 * zeros dropped) and the weight or price on it.
 */
export function parseScaleBarcode(code: string, config: ScaleBarcode | null | undefined) {
  if (!config) return null;
  const value = code.trim();
  const length = config.prefix.length + config.itemDigits + config.valueDigits + 1;
  if (value.length !== length || !/^\d+$/.test(value) || !value.startsWith(config.prefix)) return null;
  if (!hasValidCheckDigit(value)) return null;
  const itemStart = config.prefix.length;
  const valueStart = itemStart + config.itemDigits;
  const itemCode = value.slice(itemStart, valueStart).replace(/^0+(?=\d)/, '');
  const raw = Number(value.slice(valueStart, valueStart + config.valueDigits));
  const amount = raw / 10 ** config.valueDecimals;
  return config.valueType === 'WEIGHT'
    ? { itemCode, qty: round3(amount), price: null }
    : { itemCode, qty: null, price: round2(amount) };
}

/** Whether a scale label's item code is `itemCode` (the item's code, leading zeros aside). */
export function sameScaleItemCode(scaleCode: string, itemCode: string) {
  const trimmed = itemCode.trim();
  return /^\d+$/.test(trimmed) && trimmed.replace(/^0+(?=\d)/, '') === scaleCode;
}
