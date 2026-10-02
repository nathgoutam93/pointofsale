/**
 * GSTR-1 (outward supplies) for one GSTIN and period, as the JSON the GST offline tool and
 * portal accept, plus a preview and a list of problems. Pure functions over plain records,
 * so the rules can be tested without a database.
 *
 * Only B2C sales exist in this app (no customer GSTINs), so the sections are: B2CS (small,
 * net of returns), B2CL (inter-state invoices above the threshold), CDNUR (credit notes for
 * B2CL invoices), nil / exempt / non-GST, the HSN summary and the document summary.
 *
 * The JSON layout follows the GSTR-1 offline tool. Import the file into the current tool
 * before filing: the format changes from time to time (see GSTR1_JSON_VERSION).
 */

/** The offline tool version this layout was written against; check against the current tool. */
export const GSTR1_JSON_VERSION = 'GST3.2.1';

/**
 * Inter-state B2C invoices above this value (₹) are reported one by one in B2CL; the rest are
 * summarised in B2CS. ₹1,00,000 from 1 August 2024 (was ₹2,50,000); check it is still current.
 */
export const B2CL_THRESHOLD = 100000;

export type Gstr1Line = {
  itemName: string;
  hsnCode: string | null;
  uqc: string | null;
  supplyType: 'TAXABLE' | 'NIL_RATED' | 'EXEMPT' | 'NON_GST';
  taxRate: number;
  /** Base-unit quantity. */
  qty: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
};

export type Gstr1Invoice = {
  invoiceNo: string;
  documentSeries: string | null;
  createdAt: Date;
  cancelled: boolean;
  taxpayerType: 'REGULAR' | 'COMPOSITION';
  sellerGstin: string | null;
  sellerStateCode: string | null;
  placeOfSupplyStateCode: string | null;
  grandTotal: number;
  lines: Gstr1Line[];
};

export type Gstr1Return = {
  returnNo: string;
  documentSeries: string | null;
  createdAt: Date;
  totalAmount: number;
  /** The sale the goods came back from (it may be from an earlier period). */
  invoice: Gstr1Invoice;
  lines: Array<{ saleLine: Gstr1Line; qty: number; taxable: number; cgst: number; sgst: number; igst: number }>;
};

export type Gstr1Problem = { severity: 'error' | 'warning'; message: string };

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const round3 = (value: number) => Math.round((value + Number.EPSILON) * 1000) / 1000;

/** dd-mm-yyyy in `timeZone`, the date format GST returns use. */
function gstDate(at: Date, timeZone: string) {
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', { timeZone }).format(at).split('-');
  return `${day}-${month}-${year}`;
}

/** The state an invoice's seller is in: as recorded, else the GSTIN's first two digits. */
function sellerState(invoice: Gstr1Invoice, gstin: string) {
  return invoice.sellerStateCode ?? gstin.slice(0, 2);
}

function placeOfSupply(invoice: Gstr1Invoice, gstin: string) {
  return invoice.placeOfSupplyStateCode ?? sellerState(invoice, gstin);
}

function isInterState(invoice: Gstr1Invoice, gstin: string) {
  return placeOfSupply(invoice, gstin) !== sellerState(invoice, gstin);
}

/** B2CL: an inter-state invoice to an unregistered buyer above the threshold. */
export function isB2cl(invoice: Gstr1Invoice, gstin: string) {
  return isInterState(invoice, gstin) && invoice.grandTotal > B2CL_THRESHOLD;
}

type Amounts = { txval: number; iamt: number; camt: number; samt: number };
const zeroAmounts = (): Amounts => ({ txval: 0, iamt: 0, camt: 0, samt: 0 });
function addAmounts(into: Amounts, line: { taxable: number; igst: number; cgst: number; sgst: number }, sign: 1 | -1) {
  into.txval = round2(into.txval + sign * line.taxable);
  into.iamt = round2(into.iamt + sign * line.igst);
  into.camt = round2(into.camt + sign * line.cgst);
  into.samt = round2(into.samt + sign * line.sgst);
}

/** Items of one B2CL invoice or CDNUR note: its taxable lines grouped by rate. */
function itemsByRate(lines: Array<{ rate: number; taxable: number; igst: number; cgst: number; sgst: number }>) {
  const byRate = new Map<number, Amounts>();
  for (const line of lines) {
    const amounts = byRate.get(line.rate) ?? zeroAmounts();
    addAmounts(amounts, line, 1);
    byRate.set(line.rate, amounts);
  }
  return [...byRate.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rt, amounts], idx) => ({
      num: idx + 1,
      itm_det: { rt, txval: amounts.txval, iamt: amounts.iamt, csamt: 0 }
    }));
}

/** The number part after the last "/" or "-", for ordering documents within a series. */
function documentOrder(number: string) {
  const match = number.match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function documentSummary(docs: Array<{ number: string; series: string | null; cancelled: boolean }>) {
  const bySeries = new Map<string, Array<{ number: string; cancelled: boolean }>>();
  for (const doc of docs) {
    const series = doc.series ?? doc.number.replace(/[-/]?\d+$/, '');
    bySeries.set(series, [...(bySeries.get(series) ?? []), doc]);
  }
  return [...bySeries.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([series, list]) => {
      const sorted = [...list].sort((a, b) => documentOrder(a.number) - documentOrder(b.number));
      const cancel = list.filter((doc) => doc.cancelled).length;
      return { series, from: sorted[0].number, to: sorted[sorted.length - 1].number, totnum: list.length, cancel, net_issue: list.length - cancel };
    });
}

export function buildGstr1(input: {
  gstin: string;
  /** Filing period as the portal writes it: MMYYYY of the period's (last) month. */
  fp: string;
  timeZone: string;
  /** Every invoice of this GSTIN made in the period, cancelled ones included. */
  invoices: Gstr1Invoice[];
  /** Every credit note (return) of this GSTIN's sales made in the period. */
  returns: Gstr1Return[];
  /** Invoices made in the period with no GSTIN recorded (left out; reported as a problem). */
  invoicesWithoutGstin: number;
}) {
  const { gstin, timeZone } = input;
  const problems: Gstr1Problem[] = [];

  const composition = input.invoices.filter((inv) => inv.taxpayerType === 'COMPOSITION');
  if (composition.length > 0) {
    problems.push({
      severity: 'warning',
      message: `${composition.length} sale(s) made as a composition taxpayer are left out: they go in CMP-08, not GSTR-1`
    });
  }
  if (input.invoicesWithoutGstin > 0) {
    problems.push({
      severity: 'warning',
      message: `${input.invoicesWithoutGstin} sale(s) in this period have no GSTIN recorded (their branch had none) and are left out`
    });
  }

  const reported = input.invoices.filter((inv) => inv.taxpayerType === 'REGULAR' && !inv.cancelled);
  const reportedReturns = input.returns.filter((ret) => ret.invoice.taxpayerType === 'REGULAR');

  // Lines missing what the HSN summary needs.
  const missingHsn = new Set<string>();
  const missingUqc = new Set<string>();
  for (const line of [...reported.flatMap((inv) => inv.lines), ...reportedReturns.flatMap((ret) => ret.lines.map((l) => l.saleLine))]) {
    if (!line.hsnCode) missingHsn.add(line.itemName);
    if (!line.uqc) missingUqc.add(line.itemName);
  }
  if (missingHsn.size > 0) {
    problems.push({ severity: 'error', message: `No HSN code on: ${[...missingHsn].sort().join(', ')}. Add it in Items; sales keep the code they were made with, so fix these sales' items before the next period too.` });
  }
  if (missingUqc.size > 0) {
    problems.push({ severity: 'error', message: `No GST unit (UQC) on: ${[...missingUqc].sort().join(', ')}.` });
  }

  // B2CS, B2CL and nil-rated sales.
  const b2cs = new Map<string, { sply_ty: 'INTRA' | 'INTER'; pos: string; rt: number } & Amounts>();
  const nil = new Map<'INTRB2C' | 'INTRAB2C', { nil_amt: number; expt_amt: number; ngsup_amt: number }>();
  const b2cl = new Map<string, Array<{ inum: string; idt: string; val: number; itms: ReturnType<typeof itemsByRate> }>>();

  const addLine = (invoice: Gstr1Invoice, line: Gstr1Line, amounts: { taxable: number; igst: number; cgst: number; sgst: number }, sign: 1 | -1) => {
    const inter = isInterState(invoice, gstin);
    if (line.supplyType !== 'TAXABLE') {
      const key = inter ? 'INTRB2C' : 'INTRAB2C';
      const row = nil.get(key) ?? { nil_amt: 0, expt_amt: 0, ngsup_amt: 0 };
      const field = line.supplyType === 'NIL_RATED' ? 'nil_amt' : line.supplyType === 'EXEMPT' ? 'expt_amt' : 'ngsup_amt';
      row[field] = round2(row[field] + sign * amounts.taxable);
      nil.set(key, row);
      return;
    }
    const pos = placeOfSupply(invoice, gstin);
    const key = `${inter ? 'INTER' : 'INTRA'}|${pos}|${line.taxRate}`;
    const row = b2cs.get(key) ?? { sply_ty: inter ? ('INTER' as const) : ('INTRA' as const), pos, rt: line.taxRate, ...zeroAmounts() };
    addAmounts(row, amounts, sign);
    b2cs.set(key, row);
  };

  for (const invoice of reported) {
    if (isB2cl(invoice, gstin)) {
      const pos = placeOfSupply(invoice, gstin);
      const taxableLines = invoice.lines.filter((line) => line.supplyType === 'TAXABLE');
      b2cl.set(pos, [
        ...(b2cl.get(pos) ?? []),
        {
          inum: invoice.invoiceNo,
          idt: gstDate(invoice.createdAt, timeZone),
          val: round2(invoice.grandTotal),
          itms: itemsByRate(taxableLines.map((line) => ({ rate: line.taxRate, ...line })))
        }
      ]);
      // Nil-rated lines of a B2CL invoice still go in the nil section.
      for (const line of invoice.lines.filter((l) => l.supplyType !== 'TAXABLE')) addLine(invoice, line, line, 1);
      continue;
    }
    for (const line of invoice.lines) addLine(invoice, line, line, 1);
  }

  // Credit notes: for B2CL invoices, reported one by one (CDNUR); otherwise they reduce
  // B2CS and nil figures of this period.
  const cdnur: Array<{ typ: 'B2CL'; ntty: 'C'; nt_num: string; nt_dt: string; pos: string; val: number; itms: ReturnType<typeof itemsByRate> }> = [];
  for (const ret of reportedReturns) {
    if (isB2cl(ret.invoice, gstin)) {
      const taxableLines = ret.lines.filter((line) => line.saleLine.supplyType === 'TAXABLE');
      cdnur.push({
        typ: 'B2CL',
        ntty: 'C',
        nt_num: ret.returnNo,
        nt_dt: gstDate(ret.createdAt, timeZone),
        pos: placeOfSupply(ret.invoice, gstin),
        val: round2(ret.totalAmount),
        itms: itemsByRate(taxableLines.map((line) => ({ rate: line.saleLine.taxRate, ...line })))
      });
      for (const line of ret.lines.filter((l) => l.saleLine.supplyType !== 'TAXABLE')) addLine(ret.invoice, line.saleLine, line, -1);
      continue;
    }
    for (const line of ret.lines) addLine(ret.invoice, line.saleLine, line, -1);
  }

  const b2csRows = [...b2cs.values()]
    .filter((row) => row.txval !== 0 || row.iamt !== 0 || row.camt !== 0 || row.samt !== 0)
    .sort((a, b) => a.sply_ty.localeCompare(b.sply_ty) || a.pos.localeCompare(b.pos) || a.rt - b.rt);
  const negative = b2csRows.filter((row) => row.txval < 0);
  if (negative.length > 0) {
    problems.push({
      severity: 'warning',
      message: `Returns are larger than sales in ${negative.length} B2CS row(s) (state ${negative.map((r) => `${r.pos} at ${r.rt}%`).join(', ')}); check them before filing`
    });
  }

  // HSN summary: every reported line, less returns, by HSN, unit and rate.
  const hsn = new Map<string, { hsn_sc: string; desc: string; uqc: string; rt: number; qty: number } & Amounts>();
  const addHsn = (line: Gstr1Line, amounts: { qty: number; taxable: number; igst: number; cgst: number; sgst: number }, sign: 1 | -1) => {
    if (!line.hsnCode || !line.uqc) return; // reported as an error above
    const key = `${line.hsnCode}|${line.uqc}|${line.taxRate}`;
    const row = hsn.get(key) ?? { hsn_sc: line.hsnCode, desc: line.itemName.slice(0, 30), uqc: line.uqc, rt: line.taxRate, qty: 0, ...zeroAmounts() };
    row.qty = round3(row.qty + sign * amounts.qty);
    addAmounts(row, amounts, sign);
    hsn.set(key, row);
  };
  for (const invoice of reported) for (const line of invoice.lines) addHsn(line, line, 1);
  for (const ret of reportedReturns) for (const line of ret.lines) addHsn(line.saleLine, line, -1);
  const hsnRows = [...hsn.values()]
    .sort((a, b) => a.hsn_sc.localeCompare(b.hsn_sc) || a.uqc.localeCompare(b.uqc) || a.rt - b.rt)
    .map((row, idx) => ({ num: idx + 1, ...row, csamt: 0 }));

  // Document summary: invoices (cancelled ones counted) and credit notes, per series.
  const regularInvoices = input.invoices.filter((inv) => inv.taxpayerType === 'REGULAR');
  const invoiceDocs = documentSummary(regularInvoices.map((inv) => ({ number: inv.invoiceNo, series: inv.documentSeries, cancelled: inv.cancelled })));
  const creditDocs = documentSummary(reportedReturns.map((ret) => ({ number: ret.returnNo, series: ret.documentSeries, cancelled: false })));
  const tooLong = [...regularInvoices.map((inv) => inv.invoiceNo), ...reportedReturns.map((ret) => ret.returnNo)].filter((n) => n.length > 16);
  if (tooLong.length > 0) {
    problems.push({
      severity: 'warning',
      message: `${tooLong.length} document number(s) are longer than GST's 16 characters (e.g. ${tooLong[0]}); these are from before GST numbering and the portal may reject them`
    });
  }

  const docDetails = [
    ...(invoiceDocs.length > 0
      ? [{ doc_num: 1, doc_typ: 'Invoices for outward supply', docs: invoiceDocs.map(({ series: _series, ...doc }, idx) => ({ num: idx + 1, ...doc })) }]
      : []),
    ...(creditDocs.length > 0
      ? [{ doc_num: 5, doc_typ: 'Credit Note', docs: creditDocs.map(({ series: _series, ...doc }, idx) => ({ num: idx + 1, ...doc })) }]
      : [])
  ];

  const nilRows = (['INTRB2C', 'INTRAB2C'] as const)
    .filter((key) => nil.has(key))
    .map((key) => ({ sply_ty: key, ...nil.get(key)! }));

  const json = {
    gstin,
    fp: input.fp,
    version: GSTR1_JSON_VERSION,
    hash: 'hash',
    ...(b2cl.size > 0 ? { b2cl: [...b2cl.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([pos, inv]) => ({ pos, inv })) } : {}),
    ...(b2csRows.length > 0
      ? { b2cs: b2csRows.map((row) => ({ sply_ty: row.sply_ty, rt: row.rt, typ: 'OE', pos: row.pos, txval: row.txval, iamt: row.iamt, camt: row.camt, samt: row.samt, csamt: 0 })) }
      : {}),
    ...(cdnur.length > 0 ? { cdnur } : {}),
    ...(nilRows.length > 0 ? { nil: { inv: nilRows.map((row) => ({ sply_ty: row.sply_ty, expt_amt: row.expt_amt, nil_amt: row.nil_amt, ngsup_amt: row.ngsup_amt })) } } : {}),
    // All sales here are B2C, so the HSN summary is the B2C table.
    ...(hsnRows.length > 0
      ? { hsn: { hsn_b2c: hsnRows.map(({ num, hsn_sc, desc, uqc, qty, rt, txval, iamt, camt, samt, csamt }) => ({ num, hsn_sc, desc, uqc, qty, rt, txval, iamt, camt, samt, csamt })) } }
      : {}),
    ...(docDetails.length > 0 ? { doc_issue: { doc_det: docDetails } } : {})
  };

  return {
    json,
    problems,
    summary: {
      invoices: reported.length,
      cancelledInvoices: regularInvoices.length - reported.length,
      creditNotes: reportedReturns.length,
      b2cs: b2csRows,
      b2cl: [...b2cl.entries()].flatMap(([pos, invs]) => invs.map((inv) => ({ pos, ...inv }))),
      cdnur,
      nil: nilRows,
      hsn: hsnRows,
      documents: { invoices: invoiceDocs, creditNotes: creditDocs }
    }
  };
}
