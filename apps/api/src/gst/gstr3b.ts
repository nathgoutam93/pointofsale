import { round2 } from '@pos/contracts';
import type { buildGstr1 } from './gstr1';

/**
 * The sales side of GSTR-3B, from the same period's GSTR-1 so the two always agree:
 * Table 3.1 (outward supplies, net of credit notes) and Table 3.2 (inter-state supplies to
 * unregistered persons, by place of supply). Input tax credit (Table 4) needs purchase bills,
 * which this app doesn't record.
 */
type Gstr1Result = ReturnType<typeof buildGstr1>;


type TaxRow = { txval: number; iamt: number; camt: number; samt: number; csamt: number };
const zero = (): TaxRow => ({ txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 });
function add(into: TaxRow, row: { txval: number; iamt?: number; camt?: number; samt?: number }, sign: 1 | -1 = 1) {
  into.txval = round2(into.txval + sign * row.txval);
  into.iamt = round2(into.iamt + sign * (row.iamt ?? 0));
  into.camt = round2(into.camt + sign * (row.camt ?? 0));
  into.samt = round2(into.samt + sign * (row.samt ?? 0));
}

export function buildGstr3b(gstr1: Gstr1Result) {
  const { summary } = gstr1;

  // 3.1(a): taxable outward supplies (not zero rated, nil rated or exempt).
  const taxable = zero();
  for (const inv of summary.b2b) for (const item of inv.itms) add(taxable, item.itm_det);
  for (const note of summary.cdnr) for (const item of note.itms) add(taxable, item.itm_det, -1);
  for (const row of summary.b2cs) add(taxable, row);
  for (const inv of summary.b2cl) for (const item of inv.itms) add(taxable, item.itm_det);
  for (const note of summary.cdnur) for (const item of note.itms) add(taxable, item.itm_det, -1);

  // 3.1(c) nil rated and exempt; 3.1(e) non-GST.
  const nilExempt = round2(summary.nil.reduce((acc, row) => acc + row.nil_amt + row.expt_amt, 0));
  const nonGst = round2(summary.nil.reduce((acc, row) => acc + row.ngsup_amt, 0));

  // 3.2: inter-state supplies to unregistered persons, by place of supply (B2B sales are to
  // registered persons, so they don't count here).
  const interState = new Map<string, { txval: number; iamt: number }>();
  const addInter = (pos: string, txval: number, iamt: number) => {
    const row = interState.get(pos) ?? { txval: 0, iamt: 0 };
    row.txval = round2(row.txval + txval);
    row.iamt = round2(row.iamt + iamt);
    interState.set(pos, row);
  };
  for (const row of summary.b2cs.filter((r) => r.sply_ty === 'INTER')) addInter(row.pos, row.txval, row.iamt);
  for (const inv of summary.b2cl) for (const item of inv.itms) addInter(inv.pos, item.itm_det.txval, item.itm_det.iamt);
  for (const note of summary.cdnur) for (const item of note.itms) addInter(note.pos, -item.itm_det.txval, -item.itm_det.iamt);

  return {
    table31: {
      /** (a) Outward taxable supplies (other than zero rated, nil rated and exempted). */
      outwardTaxable: taxable,
      /** (b) Zero rated (exports, SEZ): none from this app. */
      outwardZeroRated: zero(),
      /** (c) Other outward supplies: nil rated and exempted. */
      outwardNilExempt: { ...zero(), txval: nilExempt },
      /** (d) Inward supplies liable to reverse charge: purchases aren't recorded. */
      inwardReverseCharge: zero(),
      /** (e) Non-GST outward supplies. */
      outwardNonGst: { ...zero(), txval: nonGst }
    },
    table32: {
      unregistered: [...interState.entries()]
        .filter(([, row]) => row.txval !== 0 || row.iamt !== 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([pos, row]) => ({ pos, ...row }))
    },
    // Item details (HSN, units) matter for GSTR-1, not 3B, so only warnings carry over.
    problems: [
      ...gstr1.problems.filter((p) => p.severity === 'warning'),
      {
        severity: 'warning' as const,
        message: 'Input tax credit (Table 4) is not included: purchase bills are not recorded in this app. Fill it in from your purchase records.'
      }
    ]
  };
}
