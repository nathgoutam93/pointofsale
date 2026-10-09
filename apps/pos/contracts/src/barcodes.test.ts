import { describe, expect, it } from 'vitest';
import { hasValidCheckDigit, parseScaleBarcode, sameScaleItemCode, scaleBarcodeSchema } from './barcodes.js';

const weight = { prefix: '2', itemDigits: 6, valueType: 'WEIGHT', valueDigits: 5, valueDecimals: 3 } as const;
const price = { ...weight, valueType: 'PRICE', valueDecimals: 2 } as const;

describe('scale barcodes', () => {
  it('checks the EAN check digit', () => {
    expect(hasValidCheckDigit('5901234123457')).toBe(true);
    expect(hasValidCheckDigit('5901234123458')).toBe(false);
    expect(hasValidCheckDigit('abc')).toBe(false);
  });

  it('reads the item code and the weight or price', () => {
    expect(parseScaleBarcode('2001234012508', weight)).toEqual({ itemCode: '1234', qty: 1.25, price: null });
    expect(parseScaleBarcode('2001234008990', price)).toEqual({ itemCode: '1234', qty: null, price: 8.99 });
    expect(sameScaleItemCode('1234', '001234')).toBe(true);
    expect(sameScaleItemCode('1234', 'TEA1')).toBe(false);
  });

  it("isn't fooled by other barcodes", () => {
    expect(parseScaleBarcode('5901234123457', weight)).toBeNull(); // another prefix
    expect(parseScaleBarcode('2001234012509', weight)).toBeNull(); // wrong check digit
    expect(parseScaleBarcode('200123401250', weight)).toBeNull(); // too short
    expect(parseScaleBarcode('2001234012508', null)).toBeNull(); // no scale
  });

  it('fits a layout in 13 digits', () => {
    expect(scaleBarcodeSchema.safeParse(weight).success).toBe(true);
    expect(scaleBarcodeSchema.safeParse({ ...weight, itemDigits: 7, valueDigits: 7 }).success).toBe(false);
  });
});
