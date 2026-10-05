// Pure helpers for the Sales screen: due dates, quantity labels and discounts.

/** Whether a bill with money owed is past its due date (calendar days in the business's time zone). */
export function isOverdue(invoice: { dueDate?: string | null }, due: number, timeZone?: string) {
  if (!invoice.dueDate || due <= 0) return false;
  const day = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(date);
  return day(new Date(invoice.dueDate)) < day(new Date());
}

export const formatQtyLabel = (qty: number) =>
  Number.isInteger(qty) ? qty.toFixed(0) : qty.toFixed(3);

export const getPricingQty = (line: { qty: number; saleUomQty?: number | null }) =>
  line.saleUomQty ?? line.qty;

export const getSaleQtyLabel = (
  line: {
    itemId: string;
    qty: number;
    saleUom?: string | null;
    saleUomQty?: number | null;
  },
  itemUomById: Map<string, string>,
) => {
  const uom = line.saleUom ?? itemUomById.get(line.itemId);
  const qty = line.saleUom ? line.saleUomQty ?? getPricingQty(line) : line.qty;
  return uom ? `${formatQtyLabel(qty)} ${uom}` : formatQtyLabel(qty);
};

export const getItemDiscountAmount = (
  line: {
    discountAllocations?: Array<{
      discountId: string;
      amount: number | string;
    }>;
  },
  discounts?: Array<{ id: string; scope: "ITEM" | "ORDER" }>,
) => {
  const itemDiscountIds = new Set(
    (discounts ?? [])
      .filter((discount) => discount.scope === "ITEM")
      .map((discount) => discount.id),
  );
  return (line.discountAllocations ?? []).reduce(
    (acc, allocation) =>
      itemDiscountIds.has(allocation.discountId)
        ? acc + Number(allocation.amount ?? 0)
        : acc,
    0,
  );
};
