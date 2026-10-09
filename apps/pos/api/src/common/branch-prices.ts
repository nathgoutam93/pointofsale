import type { Prisma } from '@prisma/client';

type Price = Prisma.Decimal | number;
type BranchPrice = { uom: string; sellPrice: Price; mrp: Price };

const sameUom = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * An item as sold at a branch: the branch's own price for a unit where it has one, else the
 * item's. The base unit's price is the item's sellPrice/mrp (and its default sale unit row).
 */
export function withBranchPrices<
  T extends { uom: string; sellPrice: Price; mrp?: Price; saleUoms: Array<{ uom: string; sellPrice: Price; mrp?: Price }> }
>(item: T, prices: BranchPrice[]): T {
  if (prices.length === 0) return item;
  const priceFor = (uom: string) => prices.find((price) => sameUom(price.uom, uom));
  const base = priceFor(item.uom);
  return {
    ...item,
    ...(base ? { sellPrice: base.sellPrice, ...(item.mrp !== undefined ? { mrp: base.mrp } : {}) } : {}),
    saleUoms: item.saleUoms.map((variant) => {
      const own = priceFor(variant.uom);
      return own ? { ...variant, sellPrice: own.sellPrice, ...(variant.mrp !== undefined ? { mrp: own.mrp } : {}) } : variant;
    })
  };
}
