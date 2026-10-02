import { describe, expect, it } from 'vitest';
import { GST_STATES, gstinCheckCharacter, gstinProblem, gstStateLabel, isGstStateCode } from './gst';

describe('gstinProblem', () => {
  it('accepts GSTINs with the right check character', () => {
    // Widely published sample GSTINs.
    for (const gstin of ['27AAPFU0939F1ZV', '29AAGCB7383J1Z4', '24AAACC1206D1ZM']) {
      expect(gstinProblem(gstin)).toBeNull();
    }
  });

  it('rejects a wrong check character (a typo)', () => {
    expect(gstinProblem('27AAPFU0939F1ZW')).toMatch(/check character/);
    expect(gstinProblem('27AAPFU0939F1ZV'.replace('0939', '0993'))).toMatch(/check character/);
  });

  it('rejects the wrong shape and unknown state codes', () => {
    expect(gstinProblem('27AAPFU0939F1Z')).toMatch(/15 characters/); // too short
    expect(gstinProblem('27aapfu0939f1zv')).toMatch(/15 characters/); // callers upper-case first
    expect(gstinProblem('27AAPFU0939F1AV')).toMatch(/15 characters/); // 14th must be Z
    const first14 = '99AAPFU0939F1Z';
    expect(gstinProblem(first14 + gstinCheckCharacter(first14))).toMatch(/not a GST state code/);
  });
});

describe('GST states', () => {
  it('has unique two-digit codes and leaves out retired ones', () => {
    const codes = GST_STATES.map((state) => state.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((code) => /^\d{2}$/.test(code))).toBe(true);
    expect(isGstStateCode('29')).toBe(true);
    expect(isGstStateCode('25')).toBe(false);
    expect(isGstStateCode('28')).toBe(false);
    expect(gstStateLabel('29')).toBe('29 - Karnataka');
  });
});
