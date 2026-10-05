import { BadRequestException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DiscountScope, Prisma, TaxpayerType } from '@prisma/client';
import { computeSaleTotals, exclusiveBase, mrpProblem, resolveDiscountAmounts } from '@pos/contracts';
import type { DiscountInput, RoundOffMode } from '@pos/contracts';
import type { SaleLineInput, ComputedSaleLine } from '../common/types';
import { toNumber, round2, round3 } from '../common/numbers';
import { assertQtyRespectsLeastCount } from '../common/quantities';
import { withBranchPrices } from '../common/branch-prices';

/**
 * A sale's lines: priced and checked against the items, totalled, and turned into the rows a
 * new invoice is written with. Used by SalesService when it makes a sale.
 */

/** The quantity a line is priced in: sale units when it has one, otherwise base units. */
function pricingQty(line: Pick<SaleLineInput, 'qty' | 'saleUomQty'>) {
  return line.saleUomQty ?? line.qty;
}

/**
 * Works out a sale line's unit, conversion, list price and tax from the item. From the
 * request only the quantity, the chosen unit and a price at or below list are used; a
 * tax or unit size that doesn't match the item means the POS screen is out of date.
 */
function resolveLinePricing(
  item: {
    name: string;
    uom: string;
    sellPrice: Prisma.Decimal;
    mrp: Prisma.Decimal;
    taxRate: Prisma.Decimal;
    taxMode: 'INCLUSIVE' | 'EXCLUSIVE';
    saleUoms: Array<{ uom: string; conversionQty: Prisma.Decimal; sellPrice: Prisma.Decimal; mrp: Prisma.Decimal; isDefault: boolean }>;
  },
  line: SaleLineInput,
  chargeTax: boolean
) {
  const taxRate = toNumber(item.taxRate);
  const taxMode = item.taxMode;
  if (Math.abs(line.taxRate - taxRate) > 1e-6 || (line.taxMode !== undefined && line.taxMode !== taxMode)) {
    throw new BadRequestException(`Tax for ${item.name} has changed. Refresh and try again.`);
  }

  const requestedUom = line.saleUom?.trim();
  const isBaseUom = !requestedUom || requestedUom.toLowerCase() === item.uom.toLowerCase();
  const variant = isBaseUom
    ? undefined
    : item.saleUoms.find((entry) => !entry.isDefault && entry.uom.toLowerCase() === requestedUom.toLowerCase());
  if (!isBaseUom && !variant) {
    throw new BadRequestException(`${item.name} is not sold in ${requestedUom}. Refresh and try again.`);
  }

  let qty = round3(line.qty);
  let saleUomQty: number | undefined;
  let saleUomConversionQty: number | undefined;
  let listRate = toNumber(item.sellPrice);
  let mrp = toNumber(item.mrp);
  if (variant) {
    if (line.saleUomQty === undefined) {
      throw new BadRequestException(`Sale line ${line.itemId} has incomplete UOM details`);
    }
    saleUomConversionQty = toNumber(variant.conversionQty);
    if (line.saleUomConversionQty !== undefined && Math.abs(line.saleUomConversionQty - saleUomConversionQty) > 1e-6) {
      throw new BadRequestException(`${item.name} ${variant.uom} size has changed. Refresh and try again.`);
    }
    saleUomQty = round3(line.saleUomQty);
    qty = round3(saleUomQty * saleUomConversionQty);
    if (Math.abs(qty - round3(line.qty)) > 1e-6) {
      throw new BadRequestException(`Sale line ${line.itemId} UOM quantity does not match stock quantity`);
    }
    listRate = toNumber(variant.sellPrice);
    mrp = toNumber(variant.mrp);
  }

  const rate = round2(line.rate);
  if (rate > listRate) {
    throw new BadRequestException(`Price for ${item.name} can't be above its list price of ${listRate.toFixed(2)}`);
  }
  // Never above the MRP (0: none printed; it includes GST), even if the list price was set above it.
  const overMrp = mrpProblem(rate, mrp, taxMode, taxRate, chargeTax);
  if (overMrp) {
    throw new BadRequestException(`Price for ${item.name} can't be above its MRP: ${overMrp}`);
  }
  return { qty, rate, listRate, saleUom: variant?.uom, saleUomQty, saleUomConversionQty, taxRate, taxMode };
}

/**
 * The sale's lines priced from their items (and the branch's own prices for them), inside the
 * caller's transaction: an item that is gone or no longer sold, a quantity finer than the item's
 * least count, or a price, tax or unit that doesn't match the item stops the sale.
 */
export async function normalizeSaleLines(
  tx: Prisma.TransactionClient,
  branchId: string,
  lines: SaleLineInput[],
  chargeTax: boolean
) {
  const normalizedLines = [];

  // Every line's item and the branch's own prices for them, in two queries.
  const itemIds = [...new Set(lines.map((line) => line.itemId))];
  const itemRows = await tx.item.findMany({
    where: { id: { in: itemIds } },
    select: {
      id: true,
      name: true,
      uom: true,
      leastCount: true,
      sellPrice: true,
      mrp: true,
      costPrice: true,
      taxRate: true,
      taxMode: true,
      hsnCode: true,
      uqc: true,
      supplyType: true,
      isActive: true,
      saleUoms: { select: { uom: true, conversionQty: true, sellPrice: true, mrp: true, isDefault: true } }
    }
  });
  const itemsById = new Map(itemRows.map((row) => [row.id, row]));
  const branchPriceRows = await tx.itemBranchPrice.findMany({
    where: { branchId, itemId: { in: itemIds } },
    select: { itemId: true, uom: true, sellPrice: true, mrp: true }
  });

  for (const line of lines) {
    const normalizedItemId = line.itemId;
    const item = itemsById.get(normalizedItemId);
    if (!item) {
      throw new NotFoundException('Item not found');
    }
    if (!item.isActive) {
      throw new BadRequestException(`${item.name} is no longer for sale`);
    }
    const pricing = resolveLinePricing(
      withBranchPrices(item, branchPriceRows.filter((price) => price.itemId === normalizedItemId)),
      line,
      chargeTax
    );
    assertQtyRespectsLeastCount(pricing.qty, toNumber(item.leastCount), `Sale line ${line.itemId}`);
    normalizedLines.push({
      ...line,
      ...pricing,
      unitCost: toNumber(item.costPrice),
      hsnCode: item.hsnCode,
      uqc: item.uqc,
      supplyType: item.supplyType,
      itemId: normalizedItemId,
      itemName: item.name,
      discounts: line.discounts ?? []
    });
  }
  return normalizedLines;
}

/**
 * A cashier may lower a sale below list price (price changes, item and order discounts
 * together) by at most `maxPercent`, measured before tax. Admins are not limited.
 */
export function assertWithinCashierDiscountLimit(
  lines: SaleLineInput[],
  computedLines: ComputedSaleLine[],
  maxPercent: number,
  chargeTax: boolean
) {
  // The list total on the same footing as the sale: without tax taken out when none is charged.
  const listTotal = round2(
    lines.reduce((acc, line) => {
      const listGross = round2(pricingQty(line) * (line.listRate ?? line.rate));
      return acc + (chargeTax ? exclusiveBase(listGross, line.taxMode, line.taxRate) : listGross);
    }, 0)
  );
  if (listTotal <= 0) return;
  const finalTotal = round2(computedLines.reduce((acc, line) => acc + line.taxableAmount, 0));
  const reduction = round2(listTotal - finalTotal);
  // One paisa of slack for rounding, so exactly the limit is allowed.
  if (reduction > round2((listTotal * maxPercent) / 100) + 0.01) {
    const percent = (reduction / listTotal) * 100;
    throw new BadRequestException(
      `Price changes and discounts take ${percent.toFixed(2)}% off this sale; cashiers can give at most ${maxPercent}%. Ask an admin.`
    );
  }
}

/**
 * Where a sale's goods go: the branch's state for a counter sale, or the state they are
 * shipped to. A composition taxpayer may not sell goods to another state.
 */
export function resolvePlaceOfSupply(branchStateCode: string | null, requested: string | undefined, taxpayerType: TaxpayerType) {
  if (!requested) return branchStateCode;
  if (!branchStateCode) {
    throw new BadRequestException("Set this branch's state in Branch Settings before choosing a place of supply");
  }
  if (requested !== branchStateCode && taxpayerType === 'COMPOSITION') {
    throw new BadRequestException("A composition taxpayer can't sell goods to another state");
  }
  return requested;
}

/** The sale's amounts, from the maths shared with the POS (@pos/contracts computeSaleTotals). */
export function calculateSaleTotals(
  lines: SaleLineInput[],
  orderDiscounts: DiscountInput[] | undefined,
  taxCalculationMode: 'AFTER_DISCOUNT' | 'BEFORE_DISCOUNT',
  chargeTax: boolean,
  interState: boolean,
  roundOff: RoundOffMode
) {
  const totals = computeSaleTotals(lines, orderDiscounts, taxCalculationMode, { chargeTax, interState, roundOff });
  const computedLines: ComputedSaleLine[] = totals.lines.map((entry) => ({
    ...entry.line,
    discountAmount: entry.discountAmount,
    taxableAmount: entry.taxable,
    taxAmount: entry.tax,
    cgstAmount: entry.cgst,
    sgstAmount: entry.sgst,
    igstAmount: entry.igst,
    netAmount: entry.net,
    grossAmount: entry.gross,
    baseExclusive: entry.baseExclusive,
    itemDiscountAmount: entry.itemDiscount,
    orderDiscountAmount: entry.orderDiscount
  }));
  return {
    computedLines,
    orderDiscountPlans: totals.orderDiscountPlans,
    subTotal: totals.subTotal,
    discountTotal: totals.discountTotal,
    orderDiscountTotal: totals.orderDiscountTotal,
    taxTotal: totals.taxTotal,
    cgstTotal: totals.cgstTotal,
    sgstTotal: totals.sgstTotal,
    igstTotal: totals.igstTotal,
    roundOff: totals.roundOff,
    grandTotal: totals.grandTotal
  };
}

/** The invoice's line rows for createMany, each with the id made for it in `createdLines`. */
export function saleLineRows(
  invoiceId: string,
  computedLines: ComputedSaleLine[],
  createdLines: Array<{ id: string }>
): Prisma.SaleInvoiceLineCreateManyInput[] {
  return computedLines.map((line, index) => ({
    id: createdLines[index].id,
    invoiceId,
    itemId: line.itemId,
    itemName: line.itemName ?? 'Unknown Item',
    qty: line.qty,
    rate: line.rate,
    listRate: line.listRate,
    unitCost: line.unitCost,
    saleUom: line.saleUom,
    saleUomQty: line.saleUomQty,
    saleUomConversionQty: line.saleUomConversionQty,
    discountAmount: line.discountAmount,
    taxMode: line.taxMode ?? 'EXCLUSIVE',
    taxRate: line.taxRate,
    taxableAmount: line.taxableAmount,
    taxAmount: line.taxAmount,
    cgstAmount: line.cgstAmount,
    sgstAmount: line.sgstAmount,
    igstAmount: line.igstAmount,
    netAmount: line.netAmount,
    hsnCode: line.hsnCode,
    uqc: line.uqc,
    supplyType: line.supplyType
  }));
}

/** The invoice's item and order discounts, and how much of each falls on each line, for createMany. */
export function discountRowsFor(
  invoiceId: string,
  computedLines: ComputedSaleLine[],
  orderDiscountPlans: ReturnType<typeof calculateSaleTotals>['orderDiscountPlans'],
  createdLines: Array<{ id: string }>
) {
  const discountRows: Prisma.DiscountCreateManyInput[] = [];
  const allocationRows: Prisma.DiscountAllocationCreateManyInput[] = [];
  computedLines.forEach((line, lineIdx) => {
    for (const discount of resolveDiscountAmounts(line.discounts, line.baseExclusive)) {
      const discountId = randomUUID();
      discountRows.push({ id: discountId, saleInvoiceId: invoiceId, scope: DiscountScope.ITEM, type: discount.type, value: discount.value });
      allocationRows.push({ discountId, saleInvoiceLineId: createdLines[lineIdx].id, amount: discount.amount });
    }
  });
  for (const orderDiscount of orderDiscountPlans) {
    const discountId = randomUUID();
    discountRows.push({ id: discountId, saleInvoiceId: invoiceId, scope: DiscountScope.ORDER, type: orderDiscount.type, value: orderDiscount.value });
    createdLines.forEach((line, lineIdx) => {
      const amount = round2(orderDiscount.allocations[lineIdx] ?? 0);
      if (amount > 0) allocationRows.push({ discountId, saleInvoiceLineId: line.id, amount });
    });
  }
  return { discountRows, allocationRows };
}
