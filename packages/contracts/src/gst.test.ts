import { describe, expect, it } from 'vitest';
import {
  defaultSupplyType,
  documentNumber,
  documentSeriesCandidates,
  documentSeriesProblem,
  financialYearCode,
  financialYearLabel,
  financialYearStart,
  GST_DOCUMENT_NUMBER_MAX_LENGTH,
  GST_STATES,
  GST_UQCS,
  gstinCheckCharacter,
  gstinProblem,
  gstStateLabel,
  hsnProblem,
  isGstStateCode,
  isGstUqc,
  suggestUqc,
  supplyTypeProblem,
  UOM_TO_UQC
} from './gst';

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

describe('GST units (UQC)', () => {
  it('suggests the UQC common unit names mean', () => {
    expect(['PCS', 'pcs', 'Pc', 'piece'].map(suggestUqc)).toEqual(['PCS', 'PCS', 'PCS', 'PCS']);
    expect(['Kg', 'kgs', 'kilogram', 'gm', 'Litre', 'ml', 'Pkt', 'dozen', 'Nos'].map(suggestUqc)).toEqual([
      'KGS', 'KGS', 'KGS', 'GMS', 'LTR', 'MLT', 'PAC', 'DOZ', 'NOS'
    ]);
    expect(suggestUqc('Tray')).toBeNull();
    expect(suggestUqc('NA')).toBeNull(); // services only, never guessed
    expect(suggestUqc('')).toBeNull();
  });

  it('maps every alias to a real UQC', () => {
    for (const uqc of Object.values(UOM_TO_UQC)) expect(isGstUqc(uqc)).toBe(true);
    expect(new Set(GST_UQCS.map((u) => u.code)).size).toBe(GST_UQCS.length);
  });
});

describe('supply type and HSN', () => {
  it('defaults from the tax rate and rejects mismatches', () => {
    expect(defaultSupplyType(18)).toBe('TAXABLE');
    expect(defaultSupplyType(0)).toBe('NIL_RATED');
    expect(supplyTypeProblem('TAXABLE', 18)).toBeNull();
    expect(supplyTypeProblem('EXEMPT', 0)).toBeNull();
    expect(supplyTypeProblem('TAXABLE', 0)).toMatch(/above 0%/);
    expect(supplyTypeProblem('EXEMPT', 5)).toMatch(/exempt item has no tax/);
  });

  it('accepts 4, 6 or 8 digits, at least the business minimum', () => {
    expect(hsnProblem('1006', 4)).toBeNull();
    expect(hsnProblem('100630', 6)).toBeNull();
    expect(hsnProblem('10063010', 6)).toBeNull();
    expect(hsnProblem('1006', 6)).toMatch(/at least 6/);
    expect(hsnProblem('10063', 4)).toMatch(/4, 6 or 8/);
    expect(hsnProblem('10A6', 4)).toMatch(/digits only/);
  });
});

describe('document numbers', () => {
  it('works out the April-March financial year', () => {
    expect(financialYearStart(2026, 3)).toBe(2025);
    expect(financialYearStart(2026, 4)).toBe(2026);
    expect(financialYearStart(2027, 1)).toBe(2026);
    expect(financialYearCode(2026)).toBe('2627');
    expect(financialYearCode(2099)).toBe('9900');
    expect(financialYearLabel(2026)).toBe('2026-27');
  });

  it('numbers documents {series}/{FY}/{5 digits}, within 16 characters for any valid series', () => {
    expect(documentNumber('MAIN', 2026, 1)).toBe('MAIN/2627/00001');
    expect(documentNumber('BLR01', 2026, 99999)).toHaveLength(GST_DOCUMENT_NUMBER_MAX_LENGTH);
  });

  it('accepts series of up to 5 letters or digits', () => {
    expect(documentSeriesProblem('BLR01')).toBeNull();
    expect(documentSeriesProblem('BLR012')).toMatch(/at most 5/);
    expect(documentSeriesProblem('BL-R')).toMatch(/letters and digits/);
    expect(documentSeriesProblem('')).toMatch(/letters and digits/);
  });

  it('suggests series from the branch code', () => {
    expect(documentSeriesCandidates('main').slice(0, 3)).toEqual(['MAIN', 'MAIN2', 'MAIN3']);
    expect(documentSeriesCandidates('BLR-01', 'R').slice(0, 2)).toEqual(['BLR0R', 'BLR2R']);
    expect(documentSeriesCandidates('---')[0]).toBe('B');
    for (const series of [...documentSeriesCandidates('VERYLONGCODE'), ...documentSeriesCandidates('VERYLONGCODE', 'R')]) {
      expect(documentSeriesProblem(series)).toBeNull();
    }
  });
});
