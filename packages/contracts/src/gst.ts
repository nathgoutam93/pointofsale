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

/** GST unit quantity codes (UQC): the unit quantities are reported in, in the HSN summary. */
export const GST_UQCS: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'BAG', name: 'Bags' },
  { code: 'BAL', name: 'Bale' },
  { code: 'BDL', name: 'Bundles' },
  { code: 'BKL', name: 'Buckles' },
  { code: 'BOU', name: 'Billion of units' },
  { code: 'BOX', name: 'Box' },
  { code: 'BTL', name: 'Bottles' },
  { code: 'BUN', name: 'Bunches' },
  { code: 'CAN', name: 'Cans' },
  { code: 'CBM', name: 'Cubic meters' },
  { code: 'CCM', name: 'Cubic centimeters' },
  { code: 'CMS', name: 'Centimeters' },
  { code: 'CTN', name: 'Cartons' },
  { code: 'DOZ', name: 'Dozens' },
  { code: 'DRM', name: 'Drums' },
  { code: 'GGK', name: 'Great gross' },
  { code: 'GMS', name: 'Grammes' },
  { code: 'GRS', name: 'Gross' },
  { code: 'GYD', name: 'Gross yards' },
  { code: 'KGS', name: 'Kilograms' },
  { code: 'KLR', name: 'Kilolitre' },
  { code: 'KME', name: 'Kilometre' },
  { code: 'LTR', name: 'Litres' },
  { code: 'MLT', name: 'Millilitre' },
  { code: 'MTR', name: 'Meters' },
  { code: 'MTS', name: 'Metric ton' },
  { code: 'NOS', name: 'Numbers' },
  { code: 'OTH', name: 'Others' },
  { code: 'PAC', name: 'Packs' },
  { code: 'PCS', name: 'Pieces' },
  { code: 'PRS', name: 'Pairs' },
  { code: 'QTL', name: 'Quintal' },
  { code: 'ROL', name: 'Rolls' },
  { code: 'SET', name: 'Sets' },
  { code: 'SQF', name: 'Square feet' },
  { code: 'SQM', name: 'Square meters' },
  { code: 'SQY', name: 'Square yards' },
  { code: 'TBS', name: 'Tablets' },
  { code: 'TGM', name: 'Ten gross' },
  { code: 'THD', name: 'Thousands' },
  { code: 'TON', name: 'Tonnes' },
  { code: 'TUB', name: 'Tubes' },
  { code: 'UGS', name: 'US gallons' },
  { code: 'UNT', name: 'Units' },
  { code: 'YDS', name: 'Yards' },
  { code: 'NA', name: 'Not applicable (services)' }
];

const uqcCodes = new Set(GST_UQCS.map((uqc) => uqc.code));

export function isGstUqc(code: string) {
  return uqcCodes.has(code);
}

/** Common ways of writing a unit, and the UQC each means. */
export const UOM_TO_UQC: Readonly<Record<string, string>> = {
  PC: 'PCS', PIECE: 'PCS', PIECES: 'PCS',
  NO: 'NOS', NUMBER: 'NOS', NUMBERS: 'NOS',
  KG: 'KGS', KILO: 'KGS', KILOS: 'KGS', KILOGRAM: 'KGS', KILOGRAMS: 'KGS',
  G: 'GMS', GM: 'GMS', GRM: 'GMS', GRAM: 'GMS', GRAMS: 'GMS',
  L: 'LTR', LT: 'LTR', LITRE: 'LTR', LITER: 'LTR', LITRES: 'LTR', LITERS: 'LTR',
  ML: 'MLT', MILLILITRE: 'MLT', MILLILITER: 'MLT',
  M: 'MTR', METER: 'MTR', METRE: 'MTR', METERS: 'MTR', METRES: 'MTR',
  CM: 'CMS',
  BOXES: 'BOX',
  DOZEN: 'DOZ', DZN: 'DOZ',
  PKT: 'PAC', PACK: 'PAC', PACKS: 'PAC', PACKET: 'PAC', PACKETS: 'PAC',
  SETS: 'SET',
  PAIR: 'PRS', PAIRS: 'PRS',
  BOTTLE: 'BTL', BOTTLES: 'BTL',
  BAGS: 'BAG',
  CARTON: 'CTN', CARTONS: 'CTN',
  ROLL: 'ROL', ROLLS: 'ROL',
  TONNE: 'TON', TONNES: 'TON',
  QUINTAL: 'QTL',
  UNIT: 'UNT', UNITS: 'UNT',
  CANS: 'CAN',
  TUBE: 'TUB', TUBES: 'TUB',
  TAB: 'TBS', TABLET: 'TBS', TABLETS: 'TBS',
  BUNDLE: 'BDL', BUNDLES: 'BDL',
  SQFT: 'SQF',
  SQMT: 'SQM'
};

/** The UQC a free-text unit most likely means (PCS, kg, Litre...), or null if unsure. */
export function suggestUqc(uom: string): string | null {
  const key = uom.toUpperCase().replace(/[^A-Z]/g, '');
  if (!key) return null;
  if (uqcCodes.has(key) && key !== 'NA') return key;
  return UOM_TO_UQC[key] ?? null;
}

/**
 * How GST treats an item's sales. TAXABLE items have a rate above 0. The others are at 0%
 * and are reported separately: NIL_RATED (0% in the rate schedule), EXEMPT (exempted by
 * notification) and NON_GST (outside GST, e.g. petrol, alcohol for drinking).
 */
export type GstSupplyType = 'TAXABLE' | 'NIL_RATED' | 'EXEMPT' | 'NON_GST';
export const GST_SUPPLY_TYPES = ['TAXABLE', 'NIL_RATED', 'EXEMPT', 'NON_GST'] as const;
export const GST_SUPPLY_TYPE_LABELS: Record<GstSupplyType, string> = {
  TAXABLE: 'Taxable',
  NIL_RATED: 'Nil rated (0%)',
  EXEMPT: 'Exempt',
  NON_GST: 'Non-GST'
};

/** The supply type a tax rate implies when none is chosen: taxable above 0%, else nil rated. */
export function defaultSupplyType(taxRate: number): GstSupplyType {
  return taxRate > 0 ? 'TAXABLE' : 'NIL_RATED';
}

/** Why a supply type and tax rate can't go together, or null when they can. */
export function supplyTypeProblem(supplyType: GstSupplyType, taxRate: number): string | null {
  if (supplyType === 'TAXABLE' && !(taxRate > 0)) {
    return 'A taxable item needs a tax rate above 0%; mark a 0% item nil rated, exempt or non-GST';
  }
  if (supplyType !== 'TAXABLE' && taxRate !== 0) {
    return `A ${GST_SUPPLY_TYPE_LABELS[supplyType].toLowerCase()} item has no tax; set its tax rate to 0%`;
  }
  return null;
}

/** HSN (goods) and SAC (services) codes are 4, 6 or 8 digits; returns may need at least `minDigits`. */
export function hsnProblem(code: string, minDigits: number): string | null {
  if (!/^\d+$/.test(code)) return 'An HSN or SAC code is digits only';
  if (![4, 6, 8].includes(code.length)) return 'An HSN or SAC code has 4, 6 or 8 digits';
  if (code.length < minDigits) return `HSN codes need at least ${minDigits} digits for this business`;
  return null;
}
