import { canEncodeCode128, code128Modules } from './code128.js';

/**
 * Barcode labels for goods: on a label printer's roll (one label a page) or on A4 sticker
 * sheets (a grid a page). The browser's print dialog prints them; sizes are in millimetres.
 */
export type LabelLayout = {
  label: string;
  kind: 'ROLL' | 'SHEET';
  labelWidthMm: number;
  labelHeightMm: number;
  /** Sheets only: the grid, and where it starts on the A4 page. */
  columns: number;
  rows: number;
  marginTopMm: number;
  marginLeftMm: number;
  gapXMm: number;
  gapYMm: number;
};

const roll = (label: string, width: number, height: number): LabelLayout => ({
  label,
  kind: 'ROLL',
  labelWidthMm: width,
  labelHeightMm: height,
  columns: 1,
  rows: 1,
  marginTopMm: 0,
  marginLeftMm: 0,
  gapXMm: 0,
  gapYMm: 0
});

export const LABEL_LAYOUTS = {
  ROLL_50X25: roll('Label roll 50 × 25 mm', 50, 25),
  ROLL_38X25: roll('Label roll 38 × 25 mm', 38, 25),
  ROLL_50X30: roll('Label roll 50 × 30 mm', 50, 30),
  ROLL_100X50: roll('Label roll 100 × 50 mm', 100, 50),
  /** Avery L7651 and its copies. */
  A4_65: { label: 'A4 sheet, 65 labels (38.1 × 21.2 mm)', kind: 'SHEET', labelWidthMm: 38.1, labelHeightMm: 21.2, columns: 5, rows: 13, marginTopMm: 10.7, marginLeftMm: 4.7, gapXMm: 2.5, gapYMm: 0 },
  /** Edge to edge, no gaps. */
  A4_40: { label: 'A4 sheet, 40 labels (52.5 × 29.7 mm)', kind: 'SHEET', labelWidthMm: 52.5, labelHeightMm: 29.7, columns: 4, rows: 10, marginTopMm: 0, marginLeftMm: 0, gapXMm: 0, gapYMm: 0 },
  /** Avery L7159 and its copies. */
  A4_24: { label: 'A4 sheet, 24 labels (63.5 × 33.9 mm)', kind: 'SHEET', labelWidthMm: 63.5, labelHeightMm: 33.9, columns: 3, rows: 8, marginTopMm: 12.9, marginLeftMm: 7.2, gapXMm: 2.5, gapYMm: 0 }
} as const satisfies Record<string, LabelLayout>;

export type LabelLayoutId = keyof typeof LABEL_LAYOUTS;
export const LABEL_LAYOUT_IDS = Object.keys(LABEL_LAYOUTS) as LabelLayoutId[];

/** What one label shows. Prices are what the customer pays (with GST). */
export type LabelData = {
  name: string;
  /** Scanned at the counter: a barcode of the item, or its item code. */
  barcode: string;
  price?: number | null;
  mrp?: number | null;
  /** Shown after the price, e.g. "/ KG". */
  unit?: string | null;
  batchNo?: string | null;
  /** YYYY-MM-DD. */
  expiryDate?: string | null;
};

export type LabelOptions = {
  storeName?: string | null;
  showPrice?: boolean;
  showMrp?: boolean;
  showBatch?: boolean;
  /** Sheets: the first position to print on (1 = top left), to use a part-used sheet. */
  startAt?: number;
};

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

const rupees = (amount: number) => `₹${amount.toFixed(2)}`;

/** Why a label can't be printed, or null: the barcode must be printable ASCII (Code 128). */
export function labelProblem(label: LabelData) {
  if (!canEncodeCode128(label.barcode)) return `${label.name}: its barcode "${label.barcode}" can't be printed (letters, digits and symbols only, up to 40)`;
  return null;
}

/** A Code 128 barcode as SVG, bars merged into runs, with quiet zones; it stretches to its box. */
export function barcodeSvg(text: string) {
  const modules = `${'0'.repeat(10)}${code128Modules(text)}${'0'.repeat(10)}`;
  const bars: string[] = [];
  for (let index = 0; index < modules.length; ) {
    if (modules[index] !== '1') {
      index += 1;
      continue;
    }
    let end = index;
    while (modules[end] === '1') end += 1;
    bars.push(`<rect x="${index}" y="0" width="${end - index}" height="1"/>`);
    index = end;
  }
  return `<svg class="bc" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${modules.length} 1" preserveAspectRatio="none" shape-rendering="crispEdges">${bars.join('')}</svg>`;
}

function labelHtml(label: LabelData, options: LabelOptions) {
  const price = options.showPrice !== false && label.price !== null && label.price !== undefined ? label.price : null;
  const mrp = options.showMrp !== false && label.mrp ? label.mrp : null;
  const unit = label.unit ? ` / ${escapeHtml(label.unit)}` : '';
  const prices = [
    price !== null ? `<span class="price">${rupees(price)}${unit}</span>` : '',
    // MRP is shown in full (with all taxes); a lower price beside it is the shop's.
    mrp !== null && (price === null || Math.abs(mrp - price) >= 0.005) ? `<span class="mrp">MRP ${rupees(mrp)}</span>` : ''
  ].join('');
  const batch =
    options.showBatch !== false && (label.batchNo || label.expiryDate)
      ? `<div class="batch">${[label.batchNo ? `Batch ${escapeHtml(label.batchNo)}` : '', label.expiryDate ? `Exp ${escapeHtml(label.expiryDate)}` : ''].filter(Boolean).join(' · ')}</div>`
      : '';
  return [
    '<div class="label">',
    options.storeName ? `<div class="store">${escapeHtml(options.storeName)}</div>` : '',
    `<div class="name">${escapeHtml(label.name)}</div>`,
    prices ? `<div class="prices">${prices}</div>` : '',
    batch,
    barcodeSvg(label.barcode),
    `<div class="code">${escapeHtml(label.barcode)}</div>`,
    '</div>'
  ].join('');
}

/**
 * A whole HTML document of labels, ready to print: one label a page on a roll, or the sheet's
 * grid a page on A4 (starting at `startAt` on the first sheet). Throws on a label that can't be
 * printed (see labelProblem).
 */
export function labelsHtml(labels: LabelData[], layoutId: LabelLayoutId, options: LabelOptions = {}) {
  const layout: LabelLayout = LABEL_LAYOUTS[layoutId];
  for (const label of labels) {
    const problem = labelProblem(label);
    if (problem) throw new Error(problem);
  }
  const width = layout.labelWidthMm;
  const height = layout.labelHeightMm;
  // Type scales with the label's height (21 mm on the smallest sheet).
  const base = Math.max(5.5, Math.min(11, height * 0.27));
  const css = `
    @page { size: ${layout.kind === 'ROLL' ? `${width}mm ${height}mm` : 'A4'}; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { position: relative; overflow: hidden; break-after: page; page-break-after: always; }
    .page:last-child { break-after: auto; page-break-after: auto; }
    .roll { width: ${width}mm; height: ${height}mm; }
    .sheet { width: 210mm; height: 297mm; }
    .slot { position: absolute; width: ${width}mm; height: ${height}mm; }
    .label { width: 100%; height: 100%; padding: 1.2mm 1.6mm; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; text-align: center; }
    .store { font-size: ${(base * 0.75).toFixed(1)}pt; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .name { font-size: ${(base * 0.85).toFixed(1)}pt; line-height: 1.1; max-height: 2.2em; overflow: hidden; word-break: break-word; }
    .prices { display: flex; justify-content: center; align-items: baseline; gap: 1.5mm; white-space: nowrap; }
    .price { font-size: ${(base * 1.1).toFixed(1)}pt; font-weight: bold; }
    .mrp { font-size: ${(base * 0.75).toFixed(1)}pt; }
    .batch { font-size: ${(base * 0.7).toFixed(1)}pt; white-space: nowrap; overflow: hidden; }
    .bc { display: block; width: 100%; height: ${(height * 0.3).toFixed(1)}mm; fill: #000; flex: none; }
    .code { font-size: ${(base * 0.7).toFixed(1)}pt; font-family: "Courier New", Courier, monospace; letter-spacing: 0.3pt; line-height: 1; }
    @media screen { body { background: #e2e8f0; padding: 8px; } .page { background: #fff; margin: 0 auto 8px; box-shadow: 0 1px 3px rgba(0,0,0,.2); } .sheet .slot { outline: 1px dashed #cbd5e1; } }
  `;

  const pages: string[] = [];
  if (layout.kind === 'ROLL') {
    for (const label of labels) pages.push(`<div class="page roll">${labelHtml(label, options)}</div>`);
  } else {
    const perSheet = layout.columns * layout.rows;
    const skip = Math.min(perSheet - 1, Math.max(0, Math.floor((options.startAt ?? 1) - 1)));
    const positions = [...Array(skip).fill(null), ...labels] as Array<LabelData | null>;
    for (let start = 0; start < positions.length; start += perSheet) {
      const slots = positions.slice(start, start + perSheet).map((label, index) => {
        const column = index % layout.columns;
        const row = Math.floor(index / layout.columns);
        const left = layout.marginLeftMm + column * (width + layout.gapXMm);
        const top = layout.marginTopMm + row * (height + layout.gapYMm);
        return `<div class="slot" style="left:${left.toFixed(2)}mm;top:${top.toFixed(2)}mm">${label ? labelHtml(label, options) : ''}</div>`;
      });
      pages.push(`<div class="page sheet">${slots.join('')}</div>`);
    }
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>Labels</title><style>${css}</style></head><body>${pages.join('')}</body></html>`;
}
