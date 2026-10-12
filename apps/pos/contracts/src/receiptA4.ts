import type { ReceiptDocument } from './receiptLayout.js';
import type { ReceiptSections } from './receiptTemplate.js';

// A sale or refund laid out on an A4 sheet: a full-page GST invoice from the same document a
// thermal receipt prints, for shops that bill on ordinary printers.

const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const money = (value: number) => value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, ''));

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const belowHundred = (n: number) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
const belowThousand = (n: number) =>
  [n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred` : '', belowHundred(n % 100)].filter(Boolean).join(' ');

/** A whole number in words, the Indian way (lakh, crore): 125000 is "One Lakh Twenty Five Thousand". */
export function indianNumberWords(value: number): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  n %= 10_000_000;
  if (crore) parts.push(`${indianNumberWords(crore)} Crore`);
  const lakh = Math.floor(n / 100_000);
  n %= 100_000;
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (n) parts.push(belowThousand(n));
  return parts.join(' ');
}

/** An amount in words, as invoices print it: "Rupees One Hundred Eighteen and Fifty Paise Only". */
export function rupeesInWords(amount: number) {
  const paise = Math.round(Math.abs(amount) * 100);
  const rupees = Math.floor(paise / 100);
  const rest = paise % 100;
  return `Rupees ${indianNumberWords(rupees)}${rest ? ` and ${belowHundred(rest)} Paise` : ''} Only`;
}

/** The A4 page's own CSS, for the element `#id`, and the sheet it prints on. */
export function a4InvoiceCss(id = 'printable-invoice') {
  return `
    @page { size: A4; margin: 12mm; }
    #${id} { font-family: "Helvetica Neue", Arial, sans-serif; color: #111827; font-size: 11px; line-height: 1.4; width: 186mm; max-width: 100%; margin: 0 auto; box-sizing: border-box; }
    #${id} .a4-head { display: flex; justify-content: space-between; gap: 16px; border-bottom: 2px solid #111827; padding-bottom: 8px; }
    #${id} .a4-store { font-size: 18px; font-weight: 700; }
    #${id} .a4-logo { max-height: 56px; max-width: 160px; object-fit: contain; display: block; margin-bottom: 4px; }
    #${id} .a4-title { font-size: 15px; font-weight: 700; text-align: right; letter-spacing: 0.04em; }
    #${id} .a4-muted { color: #4b5563; }
    #${id} .a4-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px 16px; margin: 10px 0; }
    #${id} .a4-fields b { font-weight: 600; }
    #${id} table { width: 100%; border-collapse: collapse; }
    #${id} .a4-items th { background: #f3f4f6; font-weight: 600; text-align: left; }
    #${id} .a4-items th, #${id} .a4-items td { border: 1px solid #d1d5db; padding: 4px 6px; vertical-align: top; }
    #${id} .a4-num, #${id} .a4-items th.a4-num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    #${id} .a4-sub { color: #4b5563; font-size: 10px; }
    #${id} .a4-bottom { display: flex; justify-content: space-between; gap: 16px; margin-top: 10px; }
    #${id} .a4-totals { min-width: 70mm; }
    #${id} .a4-totals td { padding: 2px 0; }
    #${id} .a4-grand td { border-top: 2px solid #111827; font-size: 13px; font-weight: 700; padding-top: 4px; }
    #${id} .a4-words { font-style: italic; margin-top: 6px; }
    #${id} .a4-footer { margin-top: 16px; border-top: 1px solid #d1d5db; padding-top: 8px; text-align: center; }
    #${id} .a4-sign { margin-top: 28px; text-align: right; }
    #${id} tr { page-break-inside: avoid; }
  `;
}

/**
 * The document as an A4 page (HTML, every value escaped). `sections` are the branch template's:
 * the logo, header, cashier, customer, HSN, payments and footer follow them, and what the law
 * asks for (title, GSTIN, place of supply, number, date, tax) always prints.
 */
export function a4InvoiceHtml(doc: ReceiptDocument, sections: ReceiptSections, logoSrc?: string | null) {
  const fields = [...doc.fields, ...doc.legalFields].filter((field) => field.value.trim() && !(field.key && !sections[field.key]));
  const hasHsn = sections.hsn && doc.items.some((item) => item.hsn);
  const hasDiscount = doc.items.some((item) => item.discount > 0);
  const hasTax = doc.items.some((item) => item.taxRate > 0 || item.taxAmount > 0);
  const head = [
    '<th>#</th>',
    '<th>Item</th>',
    hasHsn ? '<th>HSN/SAC</th>' : '',
    '<th class="a4-num">Qty</th>',
    '<th class="a4-num">Rate</th>',
    hasDiscount ? '<th class="a4-num">Discount</th>' : '',
    hasTax ? '<th class="a4-num">Taxable</th><th class="a4-num">GST</th>' : '',
    '<th class="a4-num">Amount</th>'
  ].join('');
  const rows = doc.items
    .map((item, index) => {
      const sub = item.batches ? `<div class="a4-sub">${escape(item.batches)}</div>` : '';
      return `<tr>
        <td class="a4-num">${index + 1}</td>
        <td>${escape(item.name)}${sub}</td>
        ${hasHsn ? `<td>${escape(item.hsn ?? '')}</td>` : ''}
        <td class="a4-num">${escape(item.qtyLabel || qty(item.qty))}</td>
        <td class="a4-num">${money(item.rate)}</td>
        ${hasDiscount ? `<td class="a4-num">${item.discount > 0 ? money(item.discount) : ''}</td>` : ''}
        ${hasTax ? `<td class="a4-num">${money(item.taxable)}</td><td class="a4-num">${money(item.taxAmount)}<div class="a4-sub">${qty(item.taxRate)}%</div></td>` : ''}
        <td class="a4-num">${money(item.total)}</td>
      </tr>`;
    })
    .join('');
  const totalRow = (label: string, value: string, className = '') => `<tr class="${className}"><td>${escape(label)}</td><td class="a4-num">${value}</td></tr>`;
  const totals = [
    doc.itemsTotal !== null ? totalRow('Items total', money(doc.itemsTotal)) : '',
    doc.orderDiscount > 0 ? totalRow('Discount', `-${money(doc.orderDiscount)}`) : '',
    doc.roundOff ? totalRow('Round off', money(doc.roundOff)) : '',
    ...doc.taxTotals.map((tax) => totalRow(tax.label, money(tax.amount))),
    totalRow(doc.grandTotalLabel, money(doc.grandTotal), 'a4-grand'),
    ...(sections.payments ? doc.payments.map((payment) => totalRow(payment.label, money(payment.amount))) : []),
    doc.due !== null && doc.due > 0 ? totalRow('Balance due', money(doc.due)) : ''
  ].join('');
  return `
    <div class="a4-head">
      <div>
        ${sections.logo && logoSrc ? `<img class="a4-logo" src="${escape(logoSrc)}" alt="Store logo" />` : ''}
        <div class="a4-store">${escape(doc.storeName)}</div>
        ${sections.header ? doc.headerLines.map((line) => `<div class="a4-muted">${escape(line)}</div>`).join('') : ''}
      </div>
      <div>${doc.title ? `<div class="a4-title">${escape(doc.title)}</div>` : ''}</div>
    </div>
    <div class="a4-fields">${fields.map((field) => `<div><b>${escape(field.label)}:</b> ${escape(field.value)}</div>`).join('')}</div>
    <table class="a4-items"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>
    <div class="a4-bottom">
      <div class="a4-words">${escape(rupeesInWords(doc.grandTotal))}</div>
      <table class="a4-totals"><tbody>${totals}</tbody></table>
    </div>
    <div class="a4-sign">For ${escape(doc.storeName)}<br /><br /><span class="a4-muted">Authorised signatory</span></div>
    ${
      (sections.footer && doc.footerLines.length) || doc.legalFooter.length
        ? `<div class="a4-footer">${[...(sections.footer ? doc.footerLines : []), ...doc.legalFooter].map((line) => `<div>${escape(line)}</div>`).join('')}</div>`
        : ''
    }`;
}
