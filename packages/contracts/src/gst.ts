/**
 * GST registration types. A REGULAR taxpayer charges GST on each sale and issues a Tax
 * Invoice. A COMPOSITION taxpayer can't charge GST: it issues a Bill of Supply and pays a
 * flat rate on its turnover instead.
 */

export type TaxpayerType = 'REGULAR' | 'COMPOSITION';
export type CompositionCategory = 'MANUFACTURER' | 'TRADER' | 'RESTAURANT' | 'SERVICES';
export type GstDocumentType = 'TAX_INVOICE' | 'BILL_OF_SUPPLY';

export const TAXPAYER_TYPES = ['REGULAR', 'COMPOSITION'] as const;
export const COMPOSITION_CATEGORIES = ['MANUFACTURER', 'TRADER', 'RESTAURANT', 'SERVICES'] as const;
export const GST_DOCUMENT_TYPES = ['TAX_INVOICE', 'BILL_OF_SUPPLY'] as const;

/** Tax a composition taxpayer pays on turnover, in percent (half CGST, half SGST). */
export const COMPOSITION_RATES: Record<CompositionCategory, number> = {
  MANUFACTURER: 1,
  TRADER: 1,
  RESTAURANT: 5,
  SERVICES: 6
};

export const COMPOSITION_CATEGORY_LABELS: Record<CompositionCategory, string> = {
  MANUFACTURER: 'Manufacturer',
  TRADER: 'Trader',
  RESTAURANT: 'Restaurant',
  SERVICES: 'Service provider'
};

export function documentTypeFor(taxpayerType: TaxpayerType): GstDocumentType {
  return taxpayerType === 'COMPOSITION' ? 'BILL_OF_SUPPLY' : 'TAX_INVOICE';
}

/** Whether sales charge GST on the bill. Composition taxpayers may not. */
export function chargesGst(taxpayerType: TaxpayerType) {
  return taxpayerType === 'REGULAR';
}

/**
 * GST state and union territory codes (the first two digits of a GSTIN, and the place of
 * supply in returns). Retired codes 25 (Daman and Diu, merged into 26) and 28 (undivided
 * Andhra Pradesh) are left out; 97 covers other territories (offshore areas).
 */
export const GST_STATES: ReadonlyArray<{ code: string; name: string }> = [
  { code: '01', name: 'Jammu and Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' },
  { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman and Nicobar Islands' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh' },
  { code: '97', name: 'Other Territory' }
];

const stateNames = new Map(GST_STATES.map((state) => [state.code, state.name]));

export function isGstStateCode(code: string) {
  return stateNames.has(code);
}

/** "29 - Karnataka", or the bare code if it isn't one we know. */
export function gstStateLabel(code: string) {
  const name = stateNames.get(code);
  return name ? `${code} - ${name}` : code;
}

const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** The check character (15th) for the first 14 characters of a GSTIN. */
export function gstinCheckCharacter(first14: string) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36];
}

/**
 * Why a GSTIN is invalid, or null when it is valid: 15 characters (state code, PAN, entity
 * number, Z, check character), a known state code, and the right check character.
 */
export function gstinProblem(gstin: string): string | null {
  if (!GSTIN_PATTERN.test(gstin)) {
    return 'A GSTIN is 15 characters: 2-digit state code, 10-character PAN, entity number, Z and a check character';
  }
  if (!isGstStateCode(gstin.slice(0, 2))) {
    return `${gstin.slice(0, 2)} is not a GST state code`;
  }
  if (gstinCheckCharacter(gstin.slice(0, 14)) !== gstin[14]) {
    return 'The GSTIN check character is wrong; check for a typo';
  }
  return null;
}
