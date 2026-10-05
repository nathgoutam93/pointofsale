import { describe, expect, it } from 'vitest';
import { B2CL_THRESHOLD, buildGstr1, type Gstr1Invoice, type Gstr1Line, type Gstr1Return } from '../src/gst/gstr1';
import { buildGstr3b } from '../src/gst/gstr3b';

// GST #37: the GSTR-1 rules, on hand-made invoices (no database).
const GSTIN = '29ABCDE1234F1ZW';
const at = (day: number) => new Date(Date.UTC(2026, 9, day, 6)); // October 2026, mid-day in India

const line = (o: Partial<Gstr1Line> = {}): Gstr1Line => ({
  itemName: 'Phone',
  hsnCode: '8517',
  uqc: 'NOS',
  supplyType: 'TAXABLE',
  taxRate: 18,
  qty: 1,
  taxable: 100,
  cgst: 9,
  sgst: 9,
  igst: 0,
  ...o
});

let seq = 0;
const invoice = (o: Partial<Gstr1Invoice> = {}): Gstr1Invoice => {
  seq += 1;
  const lines = o.lines ?? [line()];
  return {
    invoiceNo: `MAIN/2627/${String(seq).padStart(5, '0')}`,
    documentSeries: 'MAIN',
    createdAt: at(5),
    cancelled: false,
    taxpayerType: 'REGULAR',
    sellerGstin: GSTIN,
    sellerStateCode: '29',
    placeOfSupplyStateCode: '29',
    grandTotal: lines.reduce((acc, l) => acc + l.taxable + l.cgst + l.sgst + l.igst, 0),
    ...o,
    lines
  };
};
const interLine = (taxable: number, rate = 18) => line({ taxable, taxRate: rate, cgst: 0, sgst: 0, igst: Math.round(taxable * rate) / 100 });

const build = (invoices: Gstr1Invoice[], returns: Gstr1Return[] = [], invoicesWithoutGstin = 0) =>
  buildGstr1({ gstin: GSTIN, fp: '102026', timeZone: 'Asia/Kolkata', invoices, returns, invoicesWithoutGstin });

describe('GSTR-1 builder', () => {
  it('summarises counter sales in B2CS by rate, with CGST and SGST', () => {
    const { json, problems } = build([
      invoice({ lines: [line(), line({ taxRate: 5, taxable: 200, cgst: 5, sgst: 5, hsnCode: '1006', uqc: 'KGS', itemName: 'Rice' })] }),
      invoice()
    ]);
    expect(problems).toEqual([]);
    expect(json).toMatchObject({ gstin: GSTIN, fp: '102026' });
    expect(json.b2cs).toEqual([
      { sply_ty: 'INTRA', rt: 5, typ: 'OE', pos: '29', txval: 200, iamt: 0, camt: 5, samt: 5, csamt: 0 },
      { sply_ty: 'INTRA', rt: 18, typ: 'OE', pos: '29', txval: 200, iamt: 0, camt: 18, samt: 18, csamt: 0 }
    ]);
  });

  it('puts small inter-state sales in B2CS as IGST, and large ones in B2CL one by one', () => {
    const small = invoice({ placeOfSupplyStateCode: '27', lines: [interLine(1000)] });
    const large = invoice({ placeOfSupplyStateCode: '27', lines: [interLine(100000), interLine(10000, 5)] });
    const atThreshold = invoice({ placeOfSupplyStateCode: '27', lines: [line({ taxable: B2CL_THRESHOLD, cgst: 0, sgst: 0, igst: 0 })] });
    const { json } = build([small, large, atThreshold]);
    expect(json.b2cs).toEqual([
      { sply_ty: 'INTER', rt: 18, typ: 'OE', pos: '27', txval: 101000, iamt: 180, camt: 0, samt: 0, csamt: 0 }
    ]);
    expect(json.b2cl).toEqual([
      {
        pos: '27',
        inv: [
          {
            inum: large.invoiceNo,
            idt: '05-10-2026',
            val: 128500,
            itms: [
              { num: 1, itm_det: { rt: 5, txval: 10000, iamt: 500, csamt: 0 } },
              { num: 2, itm_det: { rt: 18, txval: 100000, iamt: 18000, csamt: 0 } }
            ]
          }
        ]
      }
    ]);
  });

  it('reports nil rated, exempt and non-GST sales separately, within and between states', () => {
    const zero = (supplyType: Gstr1Line['supplyType'], taxable: number) => line({ supplyType, taxable, taxRate: 0, cgst: 0, sgst: 0 });
    const { json } = build([
      invoice({ lines: [zero('NIL_RATED', 50), zero('EXEMPT', 30), zero('NON_GST', 20)] }),
      invoice({ placeOfSupplyStateCode: '27', lines: [zero('EXEMPT', 70)] })
    ]);
    expect(json.nil).toEqual({
      inv: [
        { sply_ty: 'INTRB2C', expt_amt: 70, nil_amt: 0, ngsup_amt: 0 },
        { sply_ty: 'INTRAB2C', expt_amt: 30, nil_amt: 50, ngsup_amt: 20 }
      ]
    });
    expect(json.b2cs).toBeUndefined();
  });

  it('nets returns of small sales out of B2CS and reports returns of B2CL invoices as credit notes', () => {
    const small = invoice({ lines: [line({ qty: 2, taxable: 200, cgst: 18, sgst: 18 })] });
    const large = invoice({ placeOfSupplyStateCode: '27', lines: [interLine(200000)] });
    const returns: Gstr1Return[] = [
      { returnNo: 'MAINR/2627/00001', documentSeries: 'MAINR', createdAt: at(9), totalAmount: 118, invoice: small, lines: [{ saleLine: small.lines[0], qty: 1, taxable: 100, cgst: 9, sgst: 9, igst: 0 }] },
      { returnNo: 'MAINR/2627/00002', documentSeries: 'MAINR', createdAt: at(10), totalAmount: 23600, invoice: large, lines: [{ saleLine: large.lines[0], qty: 1, taxable: 20000, cgst: 0, sgst: 0, igst: 3600 }] }
    ];
    const { json, summary } = build([small, large], returns);
    expect(json.b2cs).toEqual([{ sply_ty: 'INTRA', rt: 18, typ: 'OE', pos: '29', txval: 100, iamt: 0, camt: 9, samt: 9, csamt: 0 }]);
    expect(json.cdnur).toEqual([
      { typ: 'B2CL', ntty: 'C', nt_num: 'MAINR/2627/00002', nt_dt: '10-10-2026', pos: '27', val: 23600, itms: [{ num: 1, itm_det: { rt: 18, txval: 20000, iamt: 3600, csamt: 0 } }] }
    ]);
    // HSN: everything sold (200 + 200,000) less everything returned (100 + 20,000).
    expect(json.hsn).toEqual({
      hsn_b2c: [{ num: 1, hsn_sc: '8517', desc: 'Phone', uqc: 'NOS', qty: 1, rt: 18, txval: 180100, iamt: 32400, camt: 9, samt: 9, csamt: 0 }]
    });
    expect(summary.documents.creditNotes).toEqual([
      { series: 'MAINR', from: 'MAINR/2627/00001', to: 'MAINR/2627/00002', totnum: 2, cancel: 0, net_issue: 2 }
    ]);
  });

  it('counts cancelled invoices in the document summary but reports no sales for them', () => {
    const kept = invoice();
    const cancelled = invoice({ cancelled: true });
    const { json } = build([kept, cancelled]);
    expect(json.b2cs).toEqual([{ sply_ty: 'INTRA', rt: 18, typ: 'OE', pos: '29', txval: 100, iamt: 0, camt: 9, samt: 9, csamt: 0 }]);
    expect(json.doc_issue).toEqual({
      doc_det: [
        { doc_num: 1, doc_typ: 'Invoices for outward supply', docs: [{ num: 1, from: kept.invoiceNo, to: cancelled.invoiceNo, totnum: 2, cancel: 1, net_issue: 1 }] }
      ]
    });
  });

  it('leaves out composition sales, flags missing HSN codes and GST units, and old long numbers', () => {
    const { json, problems } = build(
      [
        invoice({ taxpayerType: 'COMPOSITION', lines: [line({ taxRate: 0, cgst: 0, sgst: 0 })] }),
        invoice({ lines: [line({ hsnCode: null, itemName: 'Charger' }), line({ uqc: null, itemName: 'Cable' })] }),
        invoice({ invoiceNo: 'INV-G060992-000008', documentSeries: 'INV-G060992' })
      ],
      [],
      2
    );
    expect(problems.map((p) => p.severity)).toEqual(['warning', 'warning', 'error', 'error', 'warning']);
    expect(problems[0].message).toMatch(/1 sale\(s\) made as a composition taxpayer/);
    expect(problems[1].message).toMatch(/2 sale\(s\) in this period have no GSTIN/);
    expect(problems[2].message).toMatch(/No HSN code on: Charger/);
    expect(problems[3].message).toMatch(/No GST unit \(UQC\) on: Cable/);
    expect(problems[4].message).toMatch(/INV-G060992-000008/);
    expect((json.b2cs as Array<{ txval: number }>)[0].txval).toBe(300); // composition sale left out
  });
});

describe('GSTR-1 for registered buyers', () => {
  const BUYER = '27AAACR5055K1Z5';
  const OTHER_BUYER = '29AAGCB7383J1Z4';

  it('reports their invoices one by one under their GSTIN (B2B), whatever the value or state', () => {
    const local = invoice({ buyerGstin: OTHER_BUYER, lines: [line(), line({ supplyType: 'EXEMPT', taxRate: 0, taxable: 50, cgst: 0, sgst: 0 })] });
    const shipped = invoice({ buyerGstin: BUYER, placeOfSupplyStateCode: '27', lines: [interLine(200000), interLine(1000, 5)] });
    const unregistered = invoice();
    const { json, summary, problems } = build([local, shipped, unregistered]);
    expect(problems).toEqual([]);
    expect(json.b2b).toEqual([
      {
        ctin: BUYER,
        inv: [
          {
            inum: shipped.invoiceNo,
            idt: '05-10-2026',
            val: 237050,
            pos: '27',
            rchrg: 'N',
            inv_typ: 'R',
            itms: [
              { num: 1, itm_det: { rt: 5, txval: 1000, iamt: 50, camt: 0, samt: 0, csamt: 0 } },
              { num: 2, itm_det: { rt: 18, txval: 200000, iamt: 36000, camt: 0, samt: 0, csamt: 0 } }
            ]
          }
        ]
      },
      {
        ctin: OTHER_BUYER,
        inv: [{ inum: local.invoiceNo, idt: '05-10-2026', val: 168, pos: '29', rchrg: 'N', inv_typ: 'R', itms: [{ num: 1, itm_det: { rt: 18, txval: 100, iamt: 0, camt: 9, samt: 9, csamt: 0 } }] }]
      }
    ]);
    // Not in B2CL (a registered buyer), and B2CS has only the unregistered sale.
    expect(json.b2cl).toBeUndefined();
    expect(json.b2cs).toEqual([{ sply_ty: 'INTRA', rt: 18, typ: 'OE', pos: '29', txval: 100, iamt: 0, camt: 9, samt: 9, csamt: 0 }]);
    // An exempt line to a registered buyer goes in the nil section's B2B row.
    expect(json.nil).toEqual({ inv: [{ sply_ty: 'INTRAB2B', expt_amt: 50, nil_amt: 0, ngsup_amt: 0 }] });
    // The HSN summary has a table for registered buyers and one for the rest.
    expect(json.hsn).toEqual({
      hsn_b2b: [
        { num: 1, hsn_sc: '8517', desc: 'Phone', uqc: 'NOS', qty: 1, rt: 0, txval: 50, iamt: 0, camt: 0, samt: 0, csamt: 0 },
        { num: 2, hsn_sc: '8517', desc: 'Phone', uqc: 'NOS', qty: 1, rt: 5, txval: 1000, iamt: 50, camt: 0, samt: 0, csamt: 0 },
        { num: 3, hsn_sc: '8517', desc: 'Phone', uqc: 'NOS', qty: 2, rt: 18, txval: 200100, iamt: 36000, camt: 9, samt: 9, csamt: 0 }
      ],
      hsn_b2c: [{ num: 1, hsn_sc: '8517', desc: 'Phone', uqc: 'NOS', qty: 1, rt: 18, txval: 100, iamt: 0, camt: 9, samt: 9, csamt: 0 }]
    });
    expect(summary.b2b.map((row) => [row.ctin, row.inum])).toEqual([[BUYER, shipped.invoiceNo], [OTHER_BUYER, local.invoiceNo]]);
  });

  it('reports credit notes for their invoices under their GSTIN (CDNR)', () => {
    const sale = invoice({ buyerGstin: BUYER, lines: [line({ qty: 2, taxable: 200, cgst: 18, sgst: 18 })] });
    const returns: Gstr1Return[] = [
      { returnNo: 'MAINR/2627/00003', documentSeries: 'MAINR', createdAt: at(9), totalAmount: 118, invoice: sale, lines: [{ saleLine: sale.lines[0], qty: 1, taxable: 100, cgst: 9, sgst: 9, igst: 0 }] }
    ];
    const { json } = build([sale], returns);
    expect(json.cdnr).toEqual([
      {
        ctin: BUYER,
        nt: [{ ntty: 'C', nt_num: 'MAINR/2627/00003', nt_dt: '09-10-2026', pos: '29', rchrg: 'N', inv_typ: 'R', val: 118, itms: [{ num: 1, itm_det: { rt: 18, txval: 100, iamt: 0, camt: 9, samt: 9, csamt: 0 } }] }]
      }
    ]);
    expect(json.cdnur).toBeUndefined();
    expect(json.b2cs).toBeUndefined();
    // The B2B HSN table is net of the return.
    expect(json.hsn).toEqual({ hsn_b2b: [{ num: 1, hsn_sc: '8517', desc: 'Phone', uqc: 'NOS', qty: 1, rt: 18, txval: 100, iamt: 0, camt: 9, samt: 9, csamt: 0 }] });
  });

  it('counts in GSTR-3B 3.1, but not in 3.2 (supplies to unregistered persons)', () => {
    const sale = invoice({ buyerGstin: BUYER, placeOfSupplyStateCode: '27', lines: [interLine(1000)] });
    const returns: Gstr1Return[] = [
      { returnNo: 'MAINR/2627/00004', documentSeries: 'MAINR', createdAt: at(9), totalAmount: 118, invoice: sale, lines: [{ saleLine: sale.lines[0], qty: 1, taxable: 100, cgst: 0, sgst: 0, igst: 18 }] }
    ];
    const { table31, table32 } = buildGstr3b(build([sale], returns));
    expect(table31.outwardTaxable).toEqual({ txval: 900, iamt: 162, camt: 0, samt: 0, csamt: 0 });
    expect(table32.unregistered).toEqual([]);
  });
});

describe('GSTR-3B builder', () => {
  it('totals Table 3.1 and 3.2 from the GSTR-1 figures, net of credit notes', () => {
    const intra = invoice({ lines: [line({ qty: 2, taxable: 200, cgst: 18, sgst: 18 }), line({ supplyType: 'EXEMPT', taxRate: 0, taxable: 40, cgst: 0, sgst: 0 })] });
    const large = invoice({ placeOfSupplyStateCode: '27', lines: [interLine(200000)] });
    const small = invoice({ placeOfSupplyStateCode: '33', lines: [interLine(500), line({ supplyType: 'NON_GST', taxRate: 0, taxable: 60, cgst: 0, sgst: 0 })] });
    const returns: Gstr1Return[] = [
      { returnNo: 'MAINR/2627/00001', documentSeries: 'MAINR', createdAt: at(10), totalAmount: 23600, invoice: large, lines: [{ saleLine: large.lines[0], qty: 1, taxable: 20000, cgst: 0, sgst: 0, igst: 3600 }] }
    ];
    const { table31, table32, table4, problems } = buildGstr3b(build([intra, large, small], returns));
    expect(table31.outwardTaxable).toEqual({ txval: 180700, iamt: 32490, camt: 18, samt: 18, csamt: 0 });
    expect(table31.outwardNilExempt.txval).toBe(40);
    expect(table31.outwardNonGst.txval).toBe(60);
    expect(table32.unregistered).toEqual([
      { pos: '27', txval: 180000, iamt: 32400 },
      { pos: '33', txval: 500, iamt: 90 }
    ]);
    // No purchases recorded: no input tax credit, and a note to fill it in.
    expect(table4).toEqual({ itcAvailable: { iamt: 0, camt: 0, samt: 0, csamt: 0 }, purchases: 0, purchaseReturns: 0 });
    expect(problems.map((p) => p.message).join(' ')).toMatch(/input tax credit \(Table 4\) is 0/);
    // With purchases: their tax, by kind.
    const withItc = buildGstr3b(build([intra], []), { purchases: 3, igst: 18, cgst: 4.5, sgst: 4.5 });
    expect(withItc.table4).toEqual({ itcAvailable: { iamt: 18, camt: 4.5, samt: 4.5, csamt: 0 }, purchases: 3, purchaseReturns: 0 });
  });
});
