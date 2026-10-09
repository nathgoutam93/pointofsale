import { planByCode, SUBSCRIPTION_GST_RATE } from '@pos/contracts';

/**
 * Who sells the subscription (us), for our invoices: BILLING_SELLER_NAME, BILLING_SELLER_ADDRESS
 * and BILLING_SELLER_GSTIN. With a GSTIN, prices carry GST and invoices are tax invoices; without
 * one (not registered), no GST is charged and they are receipts. BILLING_SAC prints the service
 * code; BILLING_INVOICE_PREFIX starts invoice numbers (default POS).
 */
export function seller() {
  const gstin = process.env.BILLING_SELLER_GSTIN?.trim().toUpperCase() || null;
  return {
    name: process.env.BILLING_SELLER_NAME?.trim() || 'Point of Sale',
    address: process.env.BILLING_SELLER_ADDRESS?.trim() || null,
    gstin,
    /** The GST state code: a GSTIN's first two digits. */
    state: gstin ? gstin.slice(0, 2) : null,
    sac: process.env.BILLING_SAC?.trim() || null,
    invoicePrefix: (process.env.BILLING_INVOICE_PREFIX?.trim() || 'POS').toUpperCase()
  };
}

export const subscriptionGstRate = () => (seller().gstin ? SUBSCRIPTION_GST_RATE : 0);

/** Same state as ours (or unknown): CGST and SGST, half each. Another state: IGST. */
export function splitSubscriptionGst(gst: number, buyerState: string | null) {
  const ours = seller().state;
  if (gst > 0 && ours && buyerState && buyerState !== ours) return { cgst: 0, sgst: 0, igst: gst };
  const cgst = Math.floor(gst / 2);
  return { cgst, sgst: gst - cgst, igst: 0 };
}

/** India's financial year (April to March, in IST) a date falls in, by its start year. */
export function fiscalYearOf(date: Date) {
  const ist = new Date(date.getTime() + 330 * 60_000);
  return ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
}

/** e.g. POS/26-27/00042: 16 characters at most, as GST invoice numbers must be. */
export function invoiceNumber(fiscalYear: number, seq: number) {
  const years = `${String(fiscalYear % 100).padStart(2, '0')}-${String((fiscalYear + 1) % 100).padStart(2, '0')}`;
  return `${seller().invoicePrefix.slice(0, 4)}/${years}/${String(seq).padStart(5, '0')}`;
}

export type InvoiceRecord = {
  number: string;
  issuedAt: Date;
  buyerName: string;
  buyerGstin: string | null;
  buyerState: string | null;
  plan: string;
  period: string;
  periodFrom: Date;
  periodTo: Date;
  amount: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
};

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

const rupees = (paise: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(paise / 100);

const day = (date: Date) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(date);

export const periodLabel = (period: string) => (period === 'year' ? '1 year' : '1 month');

/** The invoice as a page to print or email; everything shown is escaped. */
export function renderInvoiceHtml(invoice: InvoiceRecord) {
  const us = seller();
  const title = us.gstin ? 'Tax invoice' : 'Receipt';
  const planName = planByCode(invoice.plan)?.name ?? invoice.plan;
  const rows: Array<[string, number]> = [['Amount', invoice.amount]];
  if (invoice.cgst) rows.push(['CGST 9%', invoice.cgst]);
  if (invoice.sgst) rows.push(['SGST 9%', invoice.sgst]);
  if (invoice.igst) rows.push(['IGST 18%', invoice.igst]);
  rows.push(['Total paid', invoice.total]);
  const line = (text: string | null) => (text ? `<div>${escape(text)}</div>` : '');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escape(title)} ${escape(invoice.number)}</title>
<style>
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#111827;margin:0;padding:32px;background:#fff;font-size:14px}
.sheet{max-width:720px;margin:0 auto}
h1{font-size:22px;margin:0 0 4px}
.muted{color:#6b7280}
.row{display:flex;justify-content:space-between;gap:24px;margin:24px 0}
table{width:100%;border-collapse:collapse;margin-top:16px}
td,th{padding:8px;border-bottom:1px solid #e5e7eb;text-align:left}
td.n,th.n{text-align:right}
tr.total td{font-weight:700;border-bottom:none}
@media print{body{padding:0}}
</style></head>
<body><div class="sheet">
<h1>${escape(title)}</h1>
<div class="muted">${escape(invoice.number)} · ${escape(day(invoice.issuedAt))}</div>
<div class="row">
<div><strong>${escape(us.name)}</strong>${line(us.address)}${line(us.gstin ? `GSTIN ${us.gstin}` : null)}</div>
<div><div class="muted">Billed to</div><strong>${escape(invoice.buyerName)}</strong>${line(invoice.buyerGstin ? `GSTIN ${invoice.buyerGstin}` : null)}${line(invoice.buyerState ? `State code ${invoice.buyerState}` : null)}</div>
</div>
<table>
<tr><th>Description</th>${us.sac ? '<th>SAC</th>' : ''}<th class="n">Amount</th></tr>
<tr><td>Point of Sale, ${escape(planName)} plan, ${escape(periodLabel(invoice.period))}<div class="muted">${escape(day(invoice.periodFrom))} to ${escape(day(invoice.periodTo))}</div></td>${us.sac ? `<td>${escape(us.sac)}</td>` : ''}<td class="n">${escape(rupees(invoice.amount))}</td></tr>
</table>
<table>
${rows.map(([label, paise], index) => `<tr${index === rows.length - 1 ? ' class="total"' : ''}><td>${escape(label)}</td><td class="n">${escape(rupees(paise))}</td></tr>`).join('\n')}
</table>
</div></body></html>`;
}

/** The same, as plain text for the email body. */
export function invoiceText(invoice: InvoiceRecord) {
  const planName = planByCode(invoice.plan)?.name ?? invoice.plan;
  return [
    `${seller().gstin ? 'Tax invoice' : 'Receipt'} ${invoice.number}, ${day(invoice.issuedAt)}`,
    `${planName} plan, ${periodLabel(invoice.period)}: ${day(invoice.periodFrom)} to ${day(invoice.periodTo)}`,
    `Amount ${rupees(invoice.amount)}`,
    ...(invoice.cgst ? [`CGST ${rupees(invoice.cgst)}`, `SGST ${rupees(invoice.sgst)}`] : []),
    ...(invoice.igst ? [`IGST ${rupees(invoice.igst)}`] : []),
    `Total paid ${rupees(invoice.total)}`
  ].join('\n');
}
