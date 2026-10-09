import { z } from 'zod';

/**
 * Thermal receipt paper. Retail receipt printers come in two roll widths, and each can print
 * its text in a normal, a smaller (Font B) or a larger size. Columns are characters a line.
 *
 * - 58 mm (2 inch): 48 mm printed, 384 dots at 203 dpi. Xprinter XP-58, TVS RP 3150 Star,
 *   Rugtek RP58, Epson TM-T20 in 58 mm mode, Bluetooth mobile printers.
 * - 80 mm (3 inch): 72 mm printed, 576 dots at 203 dpi or 512 at 180 dpi. Epson TM-T20/T82/T88
 *   and TM-m30, TVS RP3160/3230, Xprinter XP-80, Star TSP100/143/650, Bixolon SRP-350,
 *   Citizen CT-S310, Posiflex, Rugtek RP80, Sewoo, Everycom.
 */
export const RECEIPT_PAPERS = {
  '58MM': { label: '58 mm (2 inch)', paperMm: 58, printableMm: 48, columns: 32 },
  '58MM_SMALL': { label: '58 mm, small text', paperMm: 58, printableMm: 48, columns: 42 },
  '80MM': { label: '80 mm (3 inch)', paperMm: 80, printableMm: 72, columns: 48 },
  '80MM_LARGE': { label: '80 mm, large text', paperMm: 80, printableMm: 72, columns: 42 },
  '80MM_SMALL': { label: '80 mm, small text', paperMm: 80, printableMm: 72, columns: 64 },
  /** A full-page invoice on an ordinary printer (see a4InvoiceHtml); its text fallback is 64 columns. */
  A4: { label: 'A4 sheet (full-page invoice)', paperMm: 210, printableMm: 186, columns: 64 }
} as const;

export type ReceiptPaper = keyof typeof RECEIPT_PAPERS;
export const RECEIPT_PAPER_IDS = Object.keys(RECEIPT_PAPERS) as [ReceiptPaper, ...ReceiptPaper[]];
export const receiptPaperSchema = z.enum(RECEIPT_PAPER_IDS);
/** The thermal roll sizes (a receipt printer's), without A4. */
export const THERMAL_PAPER_IDS = RECEIPT_PAPER_IDS.filter((id) => id !== 'A4') as Exclude<ReceiptPaper, 'A4'>[];

/**
 * How the receipt is laid out.
 * - CLASSIC: each item on its own block (name, quantity × rate, tax, discount).
 * - DETAILED: as classic plus each line's total, a GST summary by rate, item count and savings.
 * - COMPACT: one row per item in Item / Qty / Rate / Amount columns; the shortest GST receipt.
 * - MINIMAL: item and amount only, for quick service counters.
 */
export const RECEIPT_STYLES = ['CLASSIC', 'DETAILED', 'COMPACT', 'MINIMAL'] as const;
export type ReceiptStyle = (typeof RECEIPT_STYLES)[number];
export const receiptStyleSchema = z.enum(RECEIPT_STYLES);

export const RECEIPT_STYLE_LABELS: Record<ReceiptStyle, { label: string; description: string }> = {
  CLASSIC: { label: 'Classic', description: 'Each item in its own block with quantity, rate, tax and discount.' },
  DETAILED: { label: 'Detailed GST', description: 'Line totals, a GST summary by rate, item count and savings.' },
  COMPACT: { label: 'Compact', description: 'One row per item in columns. Uses the least paper.' },
  MINIMAL: { label: 'Minimal', description: 'Items and amounts only, for quick service counters.' }
};

/**
 * Parts of the receipt that can be switched off. What the law needs on a GST bill is printed
 * whatever the template: the title, GSTIN, place of supply, number, date, tax amounts and
 * the composition declaration.
 */
export const RECEIPT_SECTIONS = [
  'logo',
  'header',
  'largeStoreName',
  'cashier',
  'customer',
  'hsn',
  'itemTax',
  'itemDiscount',
  'lineTotal',
  'taxSummary',
  'itemCount',
  'savings',
  'payments',
  'largeTotal',
  'footer',
  'barcode'
] as const;
export type ReceiptSection = (typeof RECEIPT_SECTIONS)[number];

export const RECEIPT_SECTION_LABELS: Record<ReceiptSection, string> = {
  logo: 'Logo',
  header: 'Header text (address, phone)',
  largeStoreName: 'Store name in large letters',
  cashier: 'Cashier',
  customer: 'Customer name',
  hsn: 'HSN/SAC code of each item',
  itemTax: 'Tax on each item',
  itemDiscount: 'Discount on each item',
  lineTotal: 'Total of each item',
  taxSummary: 'GST summary by rate',
  itemCount: 'Number of items and total quantity',
  savings: 'What the customer saved',
  payments: 'Payments and balance due',
  largeTotal: 'Grand total in large letters',
  footer: 'Footer text',
  barcode: 'Barcode of the bill number (scan it on Returns)'
};

export type ReceiptSections = Record<ReceiptSection, boolean>;

const sectionsSchema = z.object(
  Object.fromEntries(RECEIPT_SECTIONS.map((section) => [section, z.boolean()])) as Record<ReceiptSection, z.ZodBoolean>
);

/** A branch's receipt template: the layout, the paper it is laid out for, and what it shows. */
export const receiptTemplateSchema = z.object({
  style: receiptStyleSchema,
  paper: receiptPaperSchema,
  sections: sectionsSchema
});
export type ReceiptTemplate = z.infer<typeof receiptTemplateSchema>;

const presetSections = (on: ReceiptSection[]): ReceiptSections =>
  Object.fromEntries(RECEIPT_SECTIONS.map((section) => [section, on.includes(section)])) as ReceiptSections;

/** What each layout shows until the admin changes it. */
export const RECEIPT_STYLE_PRESETS: Record<ReceiptStyle, ReceiptSections> = {
  CLASSIC: presetSections(['logo', 'header', 'cashier', 'customer', 'hsn', 'itemTax', 'itemDiscount', 'payments', 'footer']),
  DETAILED: presetSections([
    'logo',
    'header',
    'largeStoreName',
    'cashier',
    'customer',
    'hsn',
    'itemTax',
    'itemDiscount',
    'lineTotal',
    'taxSummary',
    'itemCount',
    'savings',
    'payments',
    'largeTotal',
    'footer',
    'barcode'
  ]),
  COMPACT: presetSections(['logo', 'header', 'cashier', 'customer', 'itemCount', 'payments', 'largeTotal', 'footer']),
  MINIMAL: presetSections(['header', 'payments', 'footer'])
};

export function presetTemplate(style: ReceiptStyle, paper: ReceiptPaper): ReceiptTemplate {
  return { style, paper, sections: { ...RECEIPT_STYLE_PRESETS[style] } };
}

/**
 * The paper set by the old `--receipt-ch: 32` branch CSS, from before templates. Anything
 * other than 32 meant 80 mm.
 */
export function paperFromLegacyCss(css: string | null | undefined): ReceiptPaper {
  const match = css?.match(/--receipt-ch\s*:\s*(\d+)/i);
  return match && Number(match[1]) === 32 ? '58MM' : '80MM';
}

/**
 * The template a branch prints with: its saved one, or the classic layout on the paper its
 * old CSS asked for. A saved template from a newer version that this one can't read falls
 * back the same way rather than failing to print.
 */
export function resolveReceiptTemplate(saved: unknown, legacyCss?: string | null): ReceiptTemplate {
  const parsed = receiptTemplateSchema.safeParse(saved);
  if (parsed.success) return parsed.data;
  if (saved && typeof saved === 'object') {
    // Keep what can be read: a newer section list still has the known sections.
    const value = saved as { style?: unknown; paper?: unknown; sections?: unknown };
    const style = receiptStyleSchema.safeParse(value.style);
    const paper = receiptPaperSchema.safeParse(value.paper);
    if (style.success && paper.success) {
      const sections = { ...RECEIPT_STYLE_PRESETS[style.data] };
      const savedSections = (value.sections && typeof value.sections === 'object' ? value.sections : {}) as Record<string, unknown>;
      for (const section of RECEIPT_SECTIONS) {
        if (typeof savedSections[section] === 'boolean') sections[section] = savedSections[section] as boolean;
      }
      return { style: style.data, paper: paper.data, sections };
    }
  }
  return presetTemplate('CLASSIC', paperFromLegacyCss(legacyCss));
}
