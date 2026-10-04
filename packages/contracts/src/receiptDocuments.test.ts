import { describe, expect, it } from 'vitest';
import { formatReceiptDate, formatReceiptTime, gstMetadata, invoiceDue, invoiceGstOf, invoiceReceiptItems, returnReceiptDocument, saleReceiptDocument, splitReturn } from './receiptDocuments.js';

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

describe('returns on a bill not paid in full', () => {
  it('owe the total less payments and returns taken off it', () => {
    expect(invoiceDue({ grandTotal: '300.00', paidTotal: '150.00', creditedTotal: '100.00' })).toBe(50);
    expect(invoiceDue({ grandTotal: 300, paidTotal: 300 })).toBe(0);
    expect(invoiceDue({ grandTotal: 100, paidTotal: 120 })).toBe(0);
  });

  it('come off what is owed first; only the rest is refunded', () => {
    expect(splitReturn(100, 300)).toEqual({ dueAdjusted: 100, refundAmount: 0 });
    expect(splitReturn(200, 150)).toEqual({ dueAdjusted: 150, refundAmount: 50 });
    expect(splitReturn(66.67, 0)).toEqual({ dueAdjusted: 0, refundAmount: 66.67 });
  });

  it('print what came off the due and what was handed back', () => {
    const base = {
      branding: { storeName: 'Shop', headerLines: [], footerLines: [] },
      returnNo: 'R1',
      invoiceNo: 'B1',
      createdAt: '2026-10-03T10:00:00.000Z',
      customer: 'Asha',
      refundMode: 'CASH' as const,
      items: [],
      totalAmount: 200,
      tax: { cgst: 0, sgst: 0, igst: 0 }
    };
    const offDue = returnReceiptDocument({ ...base, dueAdjusted: 200 });
    expect(offDue.title).toBe('RETURN');
    expect(offDue.payments).toEqual([{ label: 'Taken off amount due', amount: 200 }]);
    const split = returnReceiptDocument({ ...base, dueAdjusted: 150 });
    expect(split.title).toBe('REFUND');
    expect(split.payments).toEqual([
      { label: 'Taken off amount due', amount: 150 },
      { label: 'Refunded by Cash', amount: 50 }
    ]);
    // In the business's time zone when given one: 20:00 UTC is 01:30 the next day in India.
    const late = returnReceiptDocument({ ...base, createdAt: '2026-10-03T20:00:00.000Z', timeZone: 'Asia/Kolkata' });
    expect(late.fields.filter((field) => field.label === 'Date' || field.label === 'Time').map((field) => field.value)).toEqual(['04-10-2026', '01:30 AM']);
    // A paid bill prints as before.
    expect(returnReceiptDocument(base)).toMatchObject({ title: 'REFUND', grandTotalLabel: 'REFUND', payments: [{ label: 'Refunded by Cash', amount: 200 }] });
  });
});

describe('a tax invoice to a registered buyer', () => {
  it("carries the buyer's name, GSTIN, address and reference; others carry only the seller's GSTIN", () => {
    const base = { documentType: 'TAX_INVOICE' as const, sellerGstin: '29ABCDE1234F1ZW', sellerStateCode: '29', placeOfSupplyStateCode: '29', customerName: 'Rao Traders' };
    expect(gstMetadata(invoiceGstOf({ ...base, buyerGstin: '27AAACR5055K1Z5', buyerAddress: '12 MG Road\nPune 411001', reference: 'PO-7781' }))).toEqual([
      { label: 'GSTIN', value: '29ABCDE1234F1ZW' },
      { label: 'Buyer', value: 'Rao Traders', fullLine: true },
      { label: 'Buyer GSTIN', value: '27AAACR5055K1Z5' },
      { label: 'Address', value: '12 MG Road, Pune 411001', fullLine: true },
      { label: 'Ref', value: 'PO-7781', fullLine: true }
    ]);
    expect(gstMetadata(invoiceGstOf(base))).toEqual([{ label: 'GSTIN', value: '29ABCDE1234F1ZW' }]);
  });
});

describe('saleReceiptDocument', () => {
  it('prints the cash handed over and the change', () => {
    const doc = saleReceiptDocument({
      branding: { storeName: 'Shop', headerLines: [], footerLines: [] } as never,
      invoiceNo: 'MAI/1/26/00001',
      createdAt: '2026-10-03T10:00:00.000Z',
      cashier: 'asha',
      customer: 'Walk In Customer',
      gst: { documentType: 'TAX_INVOICE', sellerGstin: null, sellerStateCode: null, placeOfSupplyStateCode: null, cgstTotal: 0, sgstTotal: 0, igstTotal: 0 },
      items: [],
      orderDiscount: 0,
      grandTotal: 487,
      payments: [
        { mode: 'UPI', amount: 100 },
        { mode: 'CASH', amount: 387, tendered: 500 }
      ],
      paidTotal: 487
    });
    expect(doc.payments).toEqual([
      { label: 'Paid by UPI', amount: 100 },
      { label: 'Paid by CASH', amount: 387 },
      { label: 'Cash tendered', amount: 500 },
      { label: 'Change', amount: 113 }
    ]);
  });
});
