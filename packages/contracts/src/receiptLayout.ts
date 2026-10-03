import { canEncodeCode128 } from './code128.js';
import { RECEIPT_PAPERS, type ReceiptPaper, type ReceiptTemplate } from './receiptTemplate.js';

/** One printed line. Text lines are exactly as wide as the paper's columns (half for large ones). */
export type ReceiptLine = {
  text: string;
  strong?: boolean;
  /** Double width and height (the store name, the total): half as many characters fit. */
  large?: boolean;
  /** Print a Code 128 barcode of this value, with `text` under it. */
  barcode?: string;
};

export type ReceiptField = {
  /** Lets the template leave out the cashier or the customer; everything else always prints. */
  key?: 'cashier' | 'customer';
  label: string;
  value: string;
  /** Print as "label: value" on its own wrapped line, so a long value isn't cut short. */
  fullLine?: boolean;
};

export type ReceiptDocumentItem = {
  name: string;
  hsn: string | null;
  qty: number;
  /** The quantity with its unit, e.g. "2 PCS" or "1.5 KG". */
  qtyLabel: string;
  /** Per unit, before tax. */
  rate: number;
  /** qty × rate, before tax and discount. */
  amount: number;
  taxRate: number;
  taxAmount: number;
  /** This item's own discount. */
  discount: number;
  /** What the line comes to, tax included, after its own discount. */
  total: number;
  /** Value tax was charged on, after every discount (for the GST summary). */
  taxable: number;
};

/** Everything a printed sale, payment or refund says, independent of how it is laid out. */
export type ReceiptDocument = {
  /** TAX INVOICE, BILL OF SUPPLY, REFUND… null for none. */
  title: string | null;
  storeName: string;
  headerLines: string[];
  footerLines: string[];
  /** Printed whatever the template (the law asks for them): GSTIN, place of supply. */
  legalFields: ReceiptField[];
  /** Numbers, date, time, cashier, customer. */
  fields: ReceiptField[];
  /** The bill number the barcode carries. */
  barcodeValue: string | null;
  items: ReceiptDocumentItem[];
  /** Before the order discount. null leaves the line out. */
  itemsTotal: number | null;
  orderDiscount: number;
  /** Tax included in the total, by kind ("incl. CGST"). Always printed. */
  taxTotals: Array<{ label: string; amount: number }>;
  grandTotalLabel: string;
  grandTotal: number;
  payments: Array<{ label: string; amount: number }>;
  /** Balance left to pay; null when it doesn't apply (a refund). */
  due: number | null;
  /** Printed after the footer whatever the template: the composition declaration. */
  legalFooter: string[];
};

export type RenderedReceipt = {
  lines: ReceiptLine[];
  columns: number;
  showLogo: boolean;
};

const money = (value: number) => value.toFixed(2);
const repeat = (char: string, count: number) => char.repeat(Math.max(0, count));

export const fitLeft = (text: string, width: number) => (text.length >= width ? text.slice(0, width) : text.padEnd(width, ' '));
export const fitRight = (text: string, width: number) => (text.length >= width ? text.slice(0, width) : text.padStart(width, ' '));
export const fitCenter = (text: string, width: number) => {
  if (text.length >= width) return text.slice(0, width);
  const left = Math.floor((width - text.length) / 2);
  return `${repeat(' ', left)}${text}${repeat(' ', width - text.length - left)}`;
};

/** Splits text into lines of at most `width`, breaking between words (and inside a word too long for a line). */
export function wrapText(text: string, width: number) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (word.length > width) {
      if (current) lines.push(current);
      current = '';
      for (let i = 0; i < word.length; i += width) {
        const piece = word.slice(i, i + width);
        if (piece.length === width) lines.push(piece);
        else current = piece;
      }
      continue;
    }
    if (!current) current = word;
    else if (current.length + 1 + word.length <= width) current = `${current} ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** "label : value", the value against the right edge. */
function keyValue(label: string, value: string, width: number, labelWidth: number) {
  const base = `${fitLeft(label.trim(), labelWidth)} : `;
  const remaining = width - base.length;
  if (remaining <= 0) return fitLeft(`${label.trim()} : ${value.trim()}`, width);
  return `${base}${fitRight(value.trim(), remaining)}`;
}

/** Text on the left, an amount against the right edge; the text wraps above if both don't fit. */
function leftRight(left: string, right: string, width: number) {
  const room = width - right.length - 1;
  if (room <= 0) return [fitLeft(left, width), fitRight(right, width)];
  const wrapped = wrapText(left, room);
  return wrapped.map((line, index) =>
    index === wrapped.length - 1 ? `${fitLeft(line, room)} ${right}` : fitLeft(line, width)
  );
}

/** Columns of the Item / Qty / Rate / Amount table for a paper width. */
export function tableColumns(width: number) {
  const total = Math.max(8, Math.round(width * 0.21));
  const price = Math.max(6, Math.round(width * 0.17));
  const qty = width < 40 ? 4 : 6;
  return { width, item: width - total - price - qty, qty, price, total };
}

const formatQty = (qty: number) => String(Number(qty.toFixed(3)));

/**
 * Lays a receipt out as fixed-width text for a template and paper. `columns` overrides the
 * template's paper (a computer whose printer takes other paper).
 */
export function renderReceipt(doc: ReceiptDocument, template: ReceiptTemplate, columns?: number): RenderedReceipt {
  const width = columns ?? RECEIPT_PAPERS[template.paper].columns;
  const half = Math.floor(width / 2);
  const show = template.sections;
  const style = template.style;
  const lines: ReceiptLine[] = [];
  const separator = repeat('-', width);
  const push = (text: string, strong = false) => lines.push({ text, strong });
  const pushCentered = (text: string, strong = false) => wrapText(text, width).forEach((line) => push(fitCenter(line, width), strong));
  const pushLarge = (text: string) =>
    wrapText(text, half).forEach((line) => lines.push({ text: fitCenter(line, half), strong: true, large: true }));

  // Store and document heading.
  if (show.largeStoreName) pushLarge(doc.storeName);
  else pushCentered(doc.storeName, true);
  if (show.header) doc.headerLines.forEach((line) => pushCentered(line));
  if (doc.title) pushCentered(doc.title, true);
  push(separator);

  const fields = [...doc.fields, ...doc.legalFields].filter(
    (field) => field.value.trim() && !(field.key && !show[field.key])
  );
  if (fields.length > 0) {
    const labelWidth = Math.min(
      Math.max(0, ...fields.filter((field) => !field.fullLine).map((field) => field.label.length)),
      Math.floor(width * 0.4)
    );
    for (const field of fields) {
      if (field.fullLine) wrapText(`${field.label}: ${field.value}`, width).forEach((line) => push(fitLeft(line, width)));
      else push(keyValue(field.label, field.value, width, labelWidth));
    }
    push(separator);
  }

  // Items.
  const detailRow = (label: string, value: string) => {
    const valueWidth = Math.min(Math.max(value.length, Math.floor(width * 0.22)), Math.floor(width * 0.45));
    return fitLeft(`  ${label}`, width - valueWidth) + fitRight(value, valueWidth);
  };
  if (style === 'COMPACT') {
    const table = tableColumns(width);
    push(fitLeft('Item', table.item) + fitRight('Qty', table.qty) + fitRight('Rate', table.price) + fitRight('Amount', table.total));
    push(separator);
    for (const item of doc.items) {
      const unit = item.qty > 0 ? item.total / item.qty : item.total;
      const names = wrapText(item.name, table.item - 1);
      names.forEach((name, index) =>
        push(
          index === 0
            ? fitLeft(name, table.item) +
                fitRight(formatQty(item.qty), table.qty) +
                fitRight(money(unit), table.price) +
                fitRight(money(item.total), table.total)
            : fitLeft(name, width)
        )
      );
      if (show.hsn && item.hsn) push(fitLeft(`  HSN ${item.hsn}`, width));
      if (show.itemDiscount && item.discount > 0) push(detailRow('discount', `-${money(item.discount)}`));
    }
  } else if (style === 'MINIMAL') {
    for (const item of doc.items) {
      leftRight(`${formatQty(item.qty)} x ${item.name}`, money(item.total), width).forEach((line) => push(line));
      if (show.hsn && item.hsn) push(fitLeft(`  HSN ${item.hsn}`, width));
      if (show.itemDiscount && item.discount > 0) push(detailRow('discount', `-${money(item.discount)}`));
    }
  } else {
    doc.items.forEach((item, index) => {
      const name = style === 'DETAILED' ? `${index + 1}. ${item.name}` : item.name;
      wrapText(name, width).forEach((line) => push(fitLeft(line, width)));
      const hasTax = item.taxRate > 0 || item.taxAmount > 0;
      if (style === 'DETAILED' && show.hsn && item.hsn && show.itemTax && hasTax) {
        push(detailRow(`HSN ${item.hsn}  GST ${formatQty(item.taxRate)}%`, money(item.taxAmount)));
      } else {
        if (show.hsn && item.hsn) push(detailRow(`HSN ${item.hsn}`, ''));
      }
      push(detailRow(`${item.qtyLabel} x ${money(item.rate)}`, money(item.amount)));
      if (show.itemTax && hasTax && !(style === 'DETAILED' && show.hsn && item.hsn)) {
        push(detailRow(`tax ${formatQty(item.taxRate)}%`, money(item.taxAmount)));
      }
      if (show.itemDiscount && item.discount > 0) push(detailRow('discount', `-${money(item.discount)}`));
      if (show.lineTotal) push(detailRow('item total', money(item.total)), true);
    });
  }
  push(separator);

  // Totals: the tax included is always shown.
  const totals: Array<{ label: string; value: string }> = [];
  if (doc.itemsTotal !== null && (doc.orderDiscount > 0 || style !== 'MINIMAL')) {
    totals.push({ label: 'Items Total', value: money(doc.itemsTotal) });
  }
  if (doc.orderDiscount > 0) totals.push({ label: 'Order Discount', value: `- ${money(doc.orderDiscount)}` });
  doc.taxTotals.forEach((tax) => totals.push({ label: tax.label, value: money(tax.amount) }));
  if (totals.length > 0) {
    const labelWidth = Math.min(Math.max(...totals.map((total) => total.label.length)), Math.floor(width * 0.5));
    totals.forEach((total) => push(keyValue(total.label, total.value, width, labelWidth)));
    push(separator);
  }
  if (show.largeTotal) {
    const text = leftRight(doc.grandTotalLabel, money(doc.grandTotal), half);
    text.forEach((line) => lines.push({ text: line, strong: true, large: true }));
  } else {
    push(keyValue(doc.grandTotalLabel, money(doc.grandTotal), width, Math.max(doc.grandTotalLabel.length, 5)), true);
  }
  push(separator);

  // Payments; an unpaid balance is always shown.
  const payments = show.payments ? doc.payments.map((payment) => ({ label: payment.label, value: money(payment.amount) })) : [];
  if (doc.due !== null && (show.payments || doc.due > 0)) payments.push({ label: 'Remaining Due', value: money(doc.due) });
  if (payments.length > 0) {
    const labelWidth = Math.min(Math.max(...payments.map((payment) => payment.label.length), 7), Math.floor(width * 0.5));
    payments.forEach((payment) => push(keyValue(payment.label, payment.value, width, labelWidth)));
    push(separator);
  }

  if (show.taxSummary) {
    const byRate = new Map<number, { taxable: number; tax: number }>();
    for (const item of doc.items) {
      if (item.taxRate <= 0 && item.taxAmount <= 0) continue;
      const entry = byRate.get(item.taxRate) ?? { taxable: 0, tax: 0 };
      entry.taxable += item.taxable;
      entry.tax += item.taxAmount;
      byRate.set(item.taxRate, entry);
    }
    if (byRate.size > 0) {
      const rateWidth = 6;
      const amountWidth = Math.floor((width - rateWidth) / 2);
      const row = (rate: string, taxable: string, tax: string) =>
        fitLeft(rate, rateWidth) + fitRight(taxable, amountWidth) + fitRight(tax, width - rateWidth - amountWidth);
      push(row('GST%', 'Taxable', 'Tax'));
      [...byRate.entries()]
        .sort(([a], [b]) => a - b)
        .forEach(([rate, entry]) => push(row(`${formatQty(rate)}%`, money(entry.taxable), money(entry.tax))));
      push(separator);
    }
  }

  if (show.itemCount && doc.items.length > 0) {
    const qty = doc.items.reduce((sum, item) => sum + item.qty, 0);
    const wholeUnits = doc.items.every((item) => Number.isInteger(item.qty));
    pushCentered(`Items: ${doc.items.length}${wholeUnits ? `   Qty: ${formatQty(qty)}` : ''}`);
  }
  if (show.savings) {
    const saved = doc.items.reduce((sum, item) => sum + item.discount, 0) + doc.orderDiscount;
    if (saved > 0) pushCentered(`You saved ${money(saved)}`, true);
  }

  if (show.footer) doc.footerLines.forEach((line) => pushCentered(line));
  doc.legalFooter.forEach((line) => pushCentered(line));

  if (show.barcode && doc.barcodeValue && canEncodeCode128(doc.barcodeValue)) {
    lines.push({ text: fitCenter(doc.barcodeValue, width), barcode: doc.barcodeValue });
  }

  return { lines, columns: width, showLogo: show.logo };
}

/** Paper columns for a template paper, or a computer's own paper when it has one. */
export function receiptColumns(paper: ReceiptPaper) {
  return RECEIPT_PAPERS[paper].columns;
}
