import { describe, expect, it } from 'vitest';
import { formatReceiptDate, formatReceiptTime, invoiceReceiptItems } from './receiptDocuments.js';

describe('receipt dates', () => {
  it('are written in the business time zone when given one', () => {
    // 20:00 UTC is 01:30 the next day in India.
    expect(formatReceiptDate('2026-10-03T20:00:00.000Z', 'Asia/Kolkata')).toBe('04-10-2026');
    expect(formatReceiptTime('2026-10-03T20:00:00.000Z', 'Asia/Kolkata')).toBe('01:30 AM');
    expect(formatReceiptDate('2026-10-03T20:00:00.000Z', 'UTC')).toBe('03-10-2026');
  });
});

describe('invoiceReceiptItems', () => {
  const discounts = [
    { id: 'item-off', scope: 'ITEM' },
    { id: 'order-off', scope: 'ORDER' }
  ];

  it('splits item and order discounts, and takes the rate out of a tax-inclusive price', () => {
    const [line] = invoiceReceiptItems(
      [
        {
          itemId: 'rice',
          itemName: 'Basmati Rice',
          qty: 2,
          rate: 525,
          taxRate: 5,
          taxMode: 'INCLUSIVE',
          discountAmount: 30,
          taxableAmount: 971.43,
          taxAmount: 48.57,
          netAmount: 1020,
          hsnCode: '1006',
          discountAllocations: [
            { discountId: 'item-off', amount: 20 },
            { discountId: 'order-off', amount: 10 }
          ]
        }
      ],
      discounts,
      () => 'BAG'
    );
    expect(line).toMatchObject({ name: 'Basmati Rice', hsn: '1006', qty: 2, qtyLabel: '2 BAG', taxRate: 5, discount: 20, total: 1030 });
    expect(line.amount).toBeCloseTo(1000, 2);
    expect(line.rate).toBeCloseTo(500, 2);
  });

  it('counts sale units on the line, not the base unit', () => {
    const [line] = invoiceReceiptItems(
      [
        {
          itemId: 'soap',
          itemName: 'Soap',
          qty: 12,
          rate: 100,
          taxRate: 0,
          saleUom: 'BOX',
          saleUomQty: 1,
          discountAmount: 0,
          taxableAmount: 100,
          taxAmount: 0,
          netAmount: 100
        }
      ],
      discounts,
      () => 'PCS'
    );
    expect(line).toMatchObject({ qty: 1, qtyLabel: '1 BOX', rate: 100, total: 100 });
  });
});
