import { computeSaleTotals } from "@pos/contracts";
import { describe, expect, it } from "vitest";
import { computeLineAmounts, formatQty, getQtyDecimals, snapQtyToLeastCount, stepLineQty } from "./cartMath";
import type { CartLine } from "./types";

const line = (overrides: Partial<CartLine> = {}): CartLine => ({
  cartKey: "",
  itemId: "item-1",
  name: "Soap",
  qty: 1,
  leastCount: 1,
  rate: 118,
  discountAmount: 0,
  taxRate: 18,
  taxMode: "INCLUSIVE",
  ...overrides,
});

describe("cart line amounts", () => {
  it("takes the tax out of a price that includes it", () => {
    expect(computeLineAmounts(line())).toEqual({ taxable: 100, tax: 18, net: 118 });
  });

  it("adds the tax to a price that doesn't include it", () => {
    expect(computeLineAmounts(line({ rate: 100, taxMode: "EXCLUSIVE", qty: 2 }))).toEqual({ taxable: 200, tax: 36, net: 236 });
  });

  it("never discounts below zero", () => {
    expect(computeLineAmounts(line({ discountAmount: 500 }))).toEqual({ taxable: 0, tax: 0, net: 0 });
  });

  it("charges no tax for a seller that can't (composition): the shelf price less discount", () => {
    expect(computeLineAmounts(line({ discountAmount: 18 }), false)).toEqual({ taxable: 100, tax: 0, net: 100 });
  });

  it("prices a pack by packs sold, not base units", () => {
    // 2 boxes of 12 at 60 a box.
    expect(computeLineAmounts(line({ qty: 24, saleUomQty: 2, rate: 60, taxRate: 0 })).net).toBe(120);
  });

  it("agrees with the totals checkout sends to the server", () => {
    const cart = [
      line({ rate: 99.99, qty: 3, discountAmount: 10 }),
      line({ itemId: "item-2", rate: 45.5, taxRate: 5, taxMode: "EXCLUSIVE", qty: 1.25, leastCount: 0.25 }),
      line({ itemId: "item-3", rate: 12, taxRate: 12, qty: 7 }),
    ];
    const lines = cart.map((entry) => computeLineAmounts(entry));
    const totals = computeSaleTotals(
      cart.map((entry) => ({ ...entry, discounts: entry.discountAmount > 0 ? [{ type: "FIXED" as const, value: entry.discountAmount }] : [] })),
      [],
    );
    totals.lines.forEach((entry, i) => {
      expect(entry.taxable).toBeCloseTo(lines[i].taxable, 2);
      expect(entry.tax).toBeCloseTo(lines[i].tax, 2);
      expect(entry.net).toBeCloseTo(lines[i].net, 2);
    });
  });
});

describe("cart quantities", () => {
  it("shows as many decimals as the least count has", () => {
    expect(getQtyDecimals(1)).toBe(0);
    expect(getQtyDecimals(0.25)).toBe(2);
    expect(getQtyDecimals(0.005)).toBe(3);
    expect(formatQty(1.5, 0.5)).toBe("1.5");
  });

  it("snaps a typed quantity to the least count, never below one step", () => {
    expect(snapQtyToLeastCount(1.26, 0.25)).toBe(1.25);
    expect(snapQtyToLeastCount(0, 0.25)).toBe(0.25);
    expect(snapQtyToLeastCount(0.1 + 0.2, 0.1)).toBe(0.3);
  });

  it("steps by one pack for a pack line and by the least count otherwise", () => {
    const loose = line({ qty: 0.5, leastCount: 0.25 });
    expect(stepLineQty(loose, 1).qty).toBe(0.75);
    expect(stepLineQty(stepLineQty(loose, -1), -1).qty).toBe(0.25);

    const box = line({ qty: 12, saleUomQty: 1, saleUomConversionQty: 12 });
    expect(stepLineQty(box, 1)).toMatchObject({ qty: 24, saleUomQty: 2 });
    expect(stepLineQty(box, -1)).toMatchObject({ qty: 12, saleUomQty: 1 });
  });
});
