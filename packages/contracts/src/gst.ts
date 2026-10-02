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
