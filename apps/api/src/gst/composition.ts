import { COMPOSITION_RATES, splitGst, type CompositionCategory } from '@pos/contracts';
import type { Gstr1Invoice, Gstr1Problem, Gstr1Return } from './gstr1';

/**
 * Composition taxpayers file CMP-08 each quarter (turnover and the tax on it at the
 * composition rate) and GSTR-4 once a year. They charge no GST on sales; they pay the rate
 * on turnover themselves: traders on taxable supplies only, others on all their turnover
 * in the state (exempt supplies included).
 *
 * Purchases aren't recorded in this app, so inward supplies (and the reverse charge tax on
 * them) are missing from both returns.
 */

/** Aggregate turnover above which composition is no longer allowed, for the year so far. */
export function compositionTurnoverLimit(category: CompositionCategory) {
  // ₹50 lakh for service providers (section 10(2A)); ₹1.5 crore otherwise. Special category
  // states have lower limits (₹75 lakh for goods): check for this business.
  return category === 'SERVICES' ? 5_000_000 : 15_000_000;
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const rupees = (value: number) => `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export type CompositionRow = {
  category: CompositionCategory;
  rate: number;
  /** All outward supplies, exempt included, net of returns. */
  turnover: number;
  /** Supplies of taxable goods or services only, net of returns. */
  taxableTurnover: number;
  /** What the rate applies to: taxable turnover for traders, all turnover for the rest. */
  taxBase: number;
  cgst: number;
  sgst: number;
};

type Totals = { turnover: number; taxBase: number; cgst: number; sgst: number };

function rowsFor(invoices: Gstr1Invoice[], returns: Gstr1Return[]): CompositionRow[] {
  const byCategory = new Map<CompositionCategory, { turnover: number; taxableTurnover: number }>();
  const add = (category: CompositionCategory | null | undefined, supplyType: string, amount: number) => {
    if (!category) return;
    const row = byCategory.get(category) ?? { turnover: 0, taxableTurnover: 0 };
    row.turnover = round2(row.turnover + amount);
    if (supplyType === 'TAXABLE') row.taxableTurnover = round2(row.taxableTurnover + amount);
    byCategory.set(category, row);
  };
  for (const invoice of invoices) for (const line of invoice.lines) add(invoice.compositionCategory, line.supplyType, line.taxable);
  for (const ret of returns) for (const line of ret.lines) add(ret.invoice.compositionCategory, line.saleLine.supplyType, -line.taxable);

  return [...byCategory.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, row]) => {
      const rate = COMPOSITION_RATES[category];
      const taxBase = category === 'TRADER' ? row.taxableTurnover : row.turnover;
      const { cgst, sgst } = splitGst(round2((taxBase * rate) / 100), false);
      return { category, rate, ...row, taxBase, cgst, sgst };
    });
}

function totalsOf(rows: CompositionRow[]): Totals {
  return {
    turnover: round2(rows.reduce((acc, row) => acc + row.turnover, 0)),
    taxBase: round2(rows.reduce((acc, row) => acc + row.taxBase, 0)),
    cgst: round2(rows.reduce((acc, row) => acc + row.cgst, 0)),
    sgst: round2(rows.reduce((acc, row) => acc + row.sgst, 0))
  };
}

/**
 * Composition figures for a period: by category (the rate), with totals. Only invoices made
 * as a composition taxpayer count; cancelled ones don't.
 */
export function buildComposition(input: {
  invoices: Gstr1Invoice[];
  returns: Gstr1Return[];
  /** The business's turnover this financial year so far (all GSTINs), for the limit check. */
  yearTurnover: number;
  /** The category in force now, for the limit check (null if no longer composition). */
  currentCategory: CompositionCategory | null;
  /** For GSTR-4: the financial-year quarter (1-4) a moment falls in, to split the year. */
  quarterOf?: (at: Date) => number;
}) {
  const invoices = input.invoices.filter((inv) => inv.taxpayerType === 'COMPOSITION' && !inv.cancelled);
  const returns = input.returns.filter((ret) => ret.invoice.taxpayerType === 'COMPOSITION');
  const rows = rowsFor(invoices, returns);
  const problems: Gstr1Problem[] = [];

  const regular = input.invoices.filter((inv) => inv.taxpayerType === 'REGULAR' && !inv.cancelled).length;
  if (regular > 0) {
    problems.push({ severity: 'warning', message: `${regular} sale(s) made as a regular taxpayer are left out: they go in GSTR-1 and GSTR-3B` });
  }
  if (input.currentCategory) {
    const limit = compositionTurnoverLimit(input.currentCategory);
    if (input.yearTurnover > limit) {
      problems.push({
        severity: 'error',
        message: `Turnover this financial year is ${rupees(input.yearTurnover)}, above the ${rupees(limit)} composition limit. The business must move to regular: schedule the change in Business Settings and file the intimation (CMP-04) on the GST portal.`
      });
    } else if (input.yearTurnover >= limit * 0.8) {
      problems.push({
        severity: 'warning',
        message: `Turnover this financial year is ${rupees(input.yearTurnover)}, ${Math.round((input.yearTurnover / limit) * 100)}% of the ${rupees(limit)} composition limit.`
      });
    }
  }
  problems.push({
    severity: 'warning',
    message: 'Inward supplies (and reverse charge tax on them) are not included: purchases are not recorded in this app.'
  });

  return {
    rows,
    totals: totalsOf(rows),
    yearTurnover: round2(input.yearTurnover),
    problems,
    /** For GSTR-4: the same figures quarter by quarter (the four CMP-08s). */
    byQuarter: input.quarterOf
      ? [1, 2, 3, 4].map((quarter) => ({
          quarter,
          ...totalsOf(
            rowsFor(
              invoices.filter((inv) => input.quarterOf!(inv.createdAt) === quarter),
              returns.filter((ret) => input.quarterOf!(ret.createdAt) === quarter)
            )
          )
        }))
      : null
  };
}
