import { computeSaleTotals, exclusiveBase, round2, round3, type DiscountInput, type TaxCalculationMode, type TaxMode } from '@pos/contracts';
import type { FallbackOutbox, SyncConflict } from './fallback.service';

/**
 * The server's own check of what a fallback counter sends back. The rows were made on a
 * computer in the shop, whose database anyone there could edit, so before they go in the
 * server works the money out again from each bill's lines (the same maths as the POS and the
 * API, `computeSaleTotals`) and checks that payments, status, the cashier discount limit and
 * the stock movements agree with it, and that returns never give back more than was sold.
 * Every disagreement is a clash for a person to look at; nothing is added while there is one.
 * Pure: the caller supplies what it needs from the database.
 */

/** A sale line on the server, for returns offline of bills that came with the copy. */
export type ServerSaleLine = {
  id: string;
  invoiceNo: string;
  itemId: string;
  itemName: string;
  qty: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  /** What returns already recorded on the server took from it. */
  returned: { qty: number; taxable: number; cgst: number; sgst: number; igst: number };
};

export type OutboxContext = {
  /** The business's setting; a bill made under either mode is accepted (it may have changed since the copy). */
  taxCalculationMode: TaxCalculationMode;
  /** The most a user may take off a sale's list price, in percent; null for no limit (admins). */
  maxDiscountPercentFor: (userId: string) => number | null;
  /** Lines of bills the server already had (by id), for returns of them made offline. */
  serverSaleLines: Map<string, ServerSaleLine>;
};

const num = (value: unknown) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : NaN;
};
const str = (value: unknown) => (value === null || value === undefined ? '' : String(value));
/** Money agrees to the paisa (rounding aside). */
const same = (a: number, b: number) => Math.abs(round2(a) - round2(b)) < 0.011;
/**
 * Recomputed amounts agree within a few paise: the outbox doesn't keep the order the lines were
 * made in, and the order decides which line an order discount's last paise go to.
 */
const close = (a: number, b: number) => Math.abs(round2(a) - round2(b)) < 0.051;
const ONLINE_ONLY_MODES = new Set(['WALLET']);

type Row = Record<string, unknown>;

function sumByItem(rows: Array<{ itemId: string; qty: number }>) {
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.itemId, round3((totals.get(row.itemId) ?? 0) + row.qty));
  return totals;
}

function sameQuantities(a: Map<string, number>, b: Map<string, number>) {
  const keys = new Set([...a.keys(), ...b.keys()]);
  return [...keys].every((key) => Math.abs((a.get(key) ?? 0) - (b.get(key) ?? 0)) < 1e-6);
}

/** The bill's amounts worked out again from its lines and discounts, under one tax calculation mode. */
function recompute(entry: FallbackOutbox['invoices'][number], mode: TaxCalculationMode) {
  const invoice = entry.invoice;
  const discountsById = new Map(entry.discounts.map((row) => [str(row.id), row]));
  const itemDiscountsOf = (lineId: string): DiscountInput[] =>
    entry.allocations
      .filter((allocation) => str(allocation.saleInvoiceLineId) === lineId)
      .map((allocation) => discountsById.get(str(allocation.discountId)))
      .filter((discount): discount is Row => !!discount && discount.scope === 'ITEM')
      .map((discount) => ({ type: discount.type === 'FIXED' ? 'FIXED' : 'PERCENTAGE', value: num(discount.value) }));
  const orderDiscounts: DiscountInput[] = entry.discounts
    .filter((discount) => discount.scope === 'ORDER')
    .map((discount) => ({ type: discount.type === 'FIXED' ? 'FIXED' : 'PERCENTAGE', value: num(discount.value) }));
  const lines = entry.lines.map((line) => ({
    qty: num(line.qty),
    saleUomQty: line.saleUomQty === null || line.saleUomQty === undefined ? null : num(line.saleUomQty),
    rate: num(line.rate),
    taxRate: num(line.taxRate),
    taxMode: (line.taxMode === 'INCLUSIVE' ? 'INCLUSIVE' : 'EXCLUSIVE') as TaxMode,
    discounts: itemDiscountsOf(str(line.id))
  }));
  const seller = str(invoice.sellerStateCode);
  const place = str(invoice.placeOfSupplyStateCode);
  return computeSaleTotals(lines, orderDiscounts, mode, { interState: !!seller && !!place && seller !== place });
}

/** Where the stored bill disagrees with its recomputed amounts, if anywhere. */
function amountsProblem(entry: FallbackOutbox['invoices'][number], totals: ReturnType<typeof recompute>) {
  const invoice = entry.invoice;
  for (const [index, line] of entry.lines.entries()) {
    const computed = totals.lines[index];
    const pairs: Array<[unknown, number]> = [
      [line.discountAmount, computed.discountAmount],
      [line.taxableAmount, computed.taxable],
      [line.taxAmount, computed.tax],
      [line.cgstAmount, computed.cgst],
      [line.sgstAmount, computed.sgst],
      [line.igstAmount, computed.igst],
      [line.netAmount, computed.net]
    ];
    if (pairs.some(([stored, worked]) => !close(num(stored), worked))) return `the amounts of "${str(line.itemName)}" don't add up`;
    if (!same(num(line.netAmount), num(line.taxableAmount) + num(line.taxAmount))) return `the amounts of "${str(line.itemName)}" don't add up`;
    if (!same(num(line.taxAmount), num(line.cgstAmount) + num(line.sgstAmount) + num(line.igstAmount))) return `the tax of "${str(line.itemName)}" doesn't add up`;
  }
  // The bill's totals are exactly its own lines'.
  const sum = (field: string) => round2(entry.lines.reduce((acc, line) => acc + num(line[field]), 0));
  const exact: Array<[unknown, number]> = [
    [invoice.taxTotal, sum('taxAmount')],
    [invoice.cgstTotal, sum('cgstAmount')],
    [invoice.sgstTotal, sum('sgstAmount')],
    [invoice.igstTotal, sum('igstAmount')],
    [invoice.grandTotal, sum('netAmount')],
    [invoice.discountTotal, sum('discountAmount')]
  ];
  if (exact.some(([stored, total]) => !same(num(stored), total))) return "its totals don't match its lines";
  const totalsPairs: Array<[unknown, number]> = [
    [invoice.subTotal, totals.subTotal],
    [invoice.discountTotal, totals.discountTotal],
    [invoice.orderDiscountAmount, totals.orderDiscountTotal],
    [invoice.taxTotal, totals.taxTotal],
    [invoice.cgstTotal, totals.cgstTotal],
    [invoice.sgstTotal, totals.sgstTotal],
    [invoice.igstTotal, totals.igstTotal],
    [invoice.grandTotal, totals.grandTotal]
  ];
  if (totalsPairs.some(([stored, worked]) => !close(num(stored), worked))) return "its totals don't match its lines";
  return null;
}

export function verifyOutbox(outbox: FallbackOutbox, context: OutboxContext): SyncConflict[] {
  const conflicts: SyncConflict[] = [];
  const outboxLines = new Map<string, { invoiceNo: string; itemId: string; itemName: string; qty: number; taxable: number; cgst: number; sgst: number; igst: number }>();

  for (const entry of outbox.invoices) {
    const invoice = entry.invoice;
    const document = `Invoice ${str(invoice.invoiceNo)}`;
    const problem = (text: string) => conflicts.push({ document, problem: `Offline, ${text}; it may have been changed on that computer.` });
    for (const line of entry.lines) {
      outboxLines.set(str(line.id), {
        invoiceNo: str(invoice.invoiceNo),
        itemId: str(line.itemId),
        itemName: str(line.itemName),
        qty: num(line.qty),
        taxable: num(line.taxableAmount),
        cgst: num(line.cgstAmount),
        sgst: num(line.sgstAmount),
        igst: num(line.igstAmount)
      });
    }

    if (entry.lines.length === 0) {
      problem('it has no lines');
      continue;
    }
    if (entry.lines.some((line) => !(num(line.qty) > 0) || !(num(line.rate) >= 0) || !(num(line.taxRate) >= 0))) {
      problem('a line has an impossible quantity, price or tax rate');
      continue;
    }
    if (invoice.taxpayerType === 'COMPOSITION' && entry.lines.some((line) => num(line.taxRate) !== 0 || num(line.taxAmount) !== 0)) {
      problem('it charges GST under the composition scheme');
    }
    const aboveList = entry.lines.find((line) => line.listRate !== null && line.listRate !== undefined && num(line.rate) > num(line.listRate) + 0.005);
    if (aboveList) problem(`"${str(aboveList.itemName)}" is sold above its list price`);

    // The amounts, under the business's tax calculation mode or the other one.
    const modes: TaxCalculationMode[] = [context.taxCalculationMode, context.taxCalculationMode === 'AFTER_DISCOUNT' ? 'BEFORE_DISCOUNT' : 'AFTER_DISCOUNT'];
    const results = modes.map((mode) => ({ totals: recompute(entry, mode) })).map((result) => ({ ...result, problem: amountsProblem(entry, result.totals) }));
    const matched = results.find((result) => result.problem === null);
    if (!matched) {
      problem(results[0].problem ?? "its amounts don't add up");
      continue;
    }

    // The cashier discount limit, on the list prices as the bill records them.
    const maxPercent = context.maxDiscountPercentFor(str(invoice.createdBy));
    if (maxPercent !== null) {
      const chargeTax = invoice.taxpayerType !== 'COMPOSITION';
      const listTotal = round2(
        entry.lines.reduce((sum, line) => {
          const listRate = line.listRate === null || line.listRate === undefined ? num(line.rate) : num(line.listRate);
          const pricingQty = line.saleUomQty === null || line.saleUomQty === undefined ? num(line.qty) : num(line.saleUomQty);
          const gross = round2(pricingQty * listRate);
          const taxMode = (line.taxMode === 'INCLUSIVE' ? 'INCLUSIVE' : 'EXCLUSIVE') as TaxMode;
          return sum + (chargeTax ? exclusiveBase(gross, taxMode, num(line.taxRate)) : gross);
        }, 0)
      );
      const finalTotal = round2(matched.totals.lines.reduce((sum, line) => sum + line.taxable, 0));
      if (listTotal > 0 && round2(listTotal - finalTotal) > round2((listTotal * maxPercent) / 100) + 0.01) {
        problem(`its price changes and discounts are more than the ${maxPercent}% a cashier may give`);
      }
    }

    // Payments: cash, card or UPI only, adding up to what the bill says was paid, never more than it.
    const payments = entry.payments.map((payment) => ({ mode: str(payment.mode), amount: num(payment.amount) }));
    const paid = round2(payments.reduce((sum, payment) => sum + payment.amount, 0));
    const grandTotal = num(invoice.grandTotal);
    if (payments.some((payment) => ONLINE_ONLY_MODES.has(payment.mode) || !(payment.amount > 0))) {
      problem('it was paid in a way that needs the server');
    } else if (!same(paid, num(invoice.paidTotal)) || paid > grandTotal + 0.005) {
      problem("its payments don't match what it says was paid");
    } else {
      const settled = round2(num(invoice.paidTotal) + num(invoice.creditedTotal)) >= grandTotal - 0.005;
      const expected = settled ? 'SETTLED' : num(invoice.paidTotal) + num(invoice.creditedTotal) > 0 ? 'PARTIALLY_SETTLED' : 'DRAFT';
      if (invoice.status !== expected) {
        problem(`it is marked ${str(invoice.status).toLowerCase().replace('_', ' ')} though its payments say otherwise`);
      }
    }

    // Stock: exactly what was sold went out.
    const ledgerOut = entry.ledger.map((row) => ({ itemId: str(row.itemId), qty: num(row.qtyOut), qtyIn: num(row.qtyIn), type: str(row.txnType) }));
    if (
      ledgerOut.some((row) => row.type !== 'SALE' || row.qtyIn !== 0) ||
      !sameQuantities(sumByItem(ledgerOut), sumByItem(entry.lines.map((line) => ({ itemId: str(line.itemId), qty: num(line.qty) }))))
    ) {
      problem("its stock movements don't match what was sold");
    }
  }

  // Returns: each part of a sale line given back at most once in all, and stock back to match.
  const returnedSoFar = new Map<string, { qty: number; taxable: number; cgst: number; sgst: number; igst: number }>();
  for (const [id, line] of context.serverSaleLines) returnedSoFar.set(id, { ...line.returned });
  for (const entry of outbox.returns ?? []) {
    const ret = entry.ret;
    const document = `Return ${str(ret.returnNo)}`;
    const problem = (text: string) => conflicts.push({ document, problem: `Offline, ${text}; it may have been changed on that computer.` });
    if (str(ret.refundMode) !== 'CASH' && num(ret.refundAmount) > 0) problem('money was handed back in a way that needs the server');

    let linesOk = true;
    for (const row of entry.lines) {
      const saleLineId = str(row.saleLineId);
      const sold = outboxLines.get(saleLineId) ?? context.serverSaleLines.get(saleLineId);
      const parts = { qty: num(row.qty), taxable: num(row.taxableAmount), cgst: num(row.cgstAmount), sgst: num(row.sgstAmount), igst: num(row.igstAmount) };
      if (!sold || !(parts.qty > 0) || !same(num(row.amount), parts.taxable + parts.cgst + parts.sgst + parts.igst)) {
        linesOk = false;
        continue;
      }
      const before = returnedSoFar.get(saleLineId) ?? { qty: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
      const after = {
        qty: round3(before.qty + parts.qty),
        taxable: round2(before.taxable + parts.taxable),
        cgst: round2(before.cgst + parts.cgst),
        sgst: round2(before.sgst + parts.sgst),
        igst: round2(before.igst + parts.igst)
      };
      returnedSoFar.set(saleLineId, after);
      if (
        after.qty > sold.qty + 1e-9 ||
        after.taxable > sold.taxable + 0.011 ||
        after.cgst > sold.cgst + 0.011 ||
        after.sgst > sold.sgst + 0.011 ||
        after.igst > sold.igst + 0.011
      ) {
        problem(`more of "${sold.itemName}" on ${sold.invoiceNo} would be given back than was sold`);
      }
    }
    if (!linesOk) {
      problem("its lines don't match the bill they return goods from");
      continue;
    }
    const total = round2(entry.lines.reduce((sum, row) => sum + num(row.amount), 0));
    if (!same(num(ret.totalAmount), total) || !same(num(ret.totalAmount), num(ret.dueAdjusted) + num(ret.refundAmount))) {
      problem("its total doesn't match its lines and refund");
    }
    const ledgerIn = entry.ledger.map((row) => ({ itemId: str(row.itemId), qty: num(row.qtyIn), qtyOut: num(row.qtyOut), type: str(row.txnType) }));
    const returnedByItem = sumByItem(
      entry.lines.map((row) => {
        const sold = outboxLines.get(str(row.saleLineId)) ?? context.serverSaleLines.get(str(row.saleLineId));
        return { itemId: sold?.itemId ?? '', qty: num(row.qty) };
      })
    );
    if (ledgerIn.some((row) => row.type !== 'RETURN' || row.qtyOut !== 0) || !sameQuantities(sumByItem(ledgerIn), returnedByItem)) {
      problem("its stock movements don't match what came back");
    }
  }
  return conflicts;
}
