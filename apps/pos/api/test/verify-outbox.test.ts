import { describe, expect, it } from 'vitest';
import { computeSaleTotals, documentTypeFor, type TaxpayerType } from '@pos/contracts';
import { verifyOutbox, type OutboxContext } from '../src/fallback/verify-outbox';
import type { FallbackOutbox } from '../src/fallback/fallback.service';

// The server's check of offline sales, without a database: one bill made the way the API makes it.
function bill(options: { rate: number; listRate: number; paid: number; status: string; createdBy?: string; taxpayerType?: TaxpayerType }) {
  const taxpayerType = options.taxpayerType ?? 'REGULAR';
  const line = { qty: 2, rate: options.rate, taxRate: taxpayerType === 'REGULAR' ? 18 : 0, taxMode: 'EXCLUSIVE' as const };
  const totals = computeSaleTotals([line], []);
  const computed = totals.lines[0];
  const entry: FallbackOutbox['invoices'][number] = {
    invoice: {
      id: 'inv-1',
      invoiceNo: 'MAI/1/26/00001',
      createdBy: options.createdBy ?? 'cashier-1',
      taxpayerType,
      documentType: documentTypeFor(taxpayerType),
      sellerGstin: taxpayerType === 'UNREGISTERED' ? null : '29ABCDE1234F1ZW',
      sellerStateCode: '29',
      placeOfSupplyStateCode: '29',
      status: options.status,
      subTotal: totals.subTotal,
      discountTotal: totals.discountTotal,
      orderDiscountAmount: totals.orderDiscountTotal,
      taxTotal: totals.taxTotal,
      cgstTotal: totals.cgstTotal,
      sgstTotal: totals.sgstTotal,
      igstTotal: totals.igstTotal,
      grandTotal: totals.grandTotal,
      paidTotal: options.paid,
      creditedTotal: 0
    },
    lines: [
      {
        id: 'line-1',
        invoiceId: 'inv-1',
        itemId: 'item-1',
        itemName: 'Tea',
        qty: 2,
        rate: options.rate,
        listRate: options.listRate,
        taxRate: line.taxRate,
        taxMode: 'EXCLUSIVE',
        discountAmount: computed.discountAmount,
        taxableAmount: computed.taxable,
        taxAmount: computed.tax,
        cgstAmount: computed.cgst,
        sgstAmount: computed.sgst,
        igstAmount: computed.igst,
        netAmount: computed.net
      }
    ],
    discounts: [],
    allocations: [],
    payments: options.paid > 0 ? [{ id: 'pay-1', invoiceId: 'inv-1', mode: 'UPI', amount: options.paid }] : [],
    receipts: [],
    ledger: [{ id: 'led-1', branchId: 'b', itemId: 'item-1', txnType: 'SALE', qtyIn: 0, qtyOut: 2, referenceType: 'SALE', referenceId: 'inv-1' }]
  };
  return { entry, grandTotal: totals.grandTotal };
}

const outbox = (entry: FallbackOutbox['invoices'][number]): FallbackOutbox => ({
  schemaVersion: 'x',
  registers: [],
  invoices: [entry],
  sequences: [],
  receiptSeq: 0,
  returns: []
});
const context: OutboxContext = {
  maxDiscountPercentFor: (userId) => (userId === 'admin-1' ? null : 10),
  serverSaleLines: new Map()
};

describe('verifyOutbox', () => {
  it('accepts an ordinary unregistered invoice and refuses a forged GST document type', () => {
    const ordinary = bill({ rate: 100, listRate: 100, paid: 200, status: 'SETTLED', taxpayerType: 'UNREGISTERED' });
    expect(verifyOutbox(outbox(ordinary.entry), context)).toEqual([]);
    ordinary.entry.invoice.documentType = 'TAX_INVOICE';
    expect(verifyOutbox(outbox(ordinary.entry), context)).toEqual(expect.arrayContaining([
      { document: 'Invoice MAI/1/26/00001', problem: expect.stringMatching(/document type does not match/) }
    ]));
  });
  it('accepts a rounded return and rejects an adjustment opposite to the original invoice', () => {
    const { entry } = bill({ rate: 42.54, listRate: 42.54, paid: 100, status: 'SETTLED' });
    const line = entry.lines[0];
    const adjustment = Math.round((100 - Number(entry.invoice.grandTotal)) * 100) / 100;
    entry.invoice.roundOff = adjustment;
    entry.invoice.grandTotal = 100;
    const data = outbox(entry);
    data.returns = [{
      ret: { id: 'return-1', returnNo: 'R1', saleInvoiceId: 'inv-1', totalAmount: 100, roundOff: adjustment, dueAdjusted: 0, refundAmount: 100, refundMode: 'CASH' },
      lines: [{ saleLineId: line.id, qty: 2, amount: line.netAmount, taxableAmount: line.taxableAmount, cgstAmount: line.cgstAmount, sgstAmount: line.sgstAmount, igstAmount: line.igstAmount }],
      ledger: [{ itemId: 'item-1', txnType: 'RETURN', qtyIn: 2, qtyOut: 0 }]
    }];
    expect(verifyOutbox(data, context)).toEqual([]);
    data.returns[0].ret.roundOff = -adjustment;
    expect(verifyOutbox(data, context)).toEqual(expect.arrayContaining([
      { document: 'Return R1', problem: expect.stringMatching(/rounding reverses more/) }
    ]));
  });

  it('accepts a bill made the way the API makes it, paid by UPI or left on credit', () => {
    const paid = bill({ rate: 100, listRate: 100, paid: 0, status: 'DRAFT' });
    expect(verifyOutbox(outbox(paid.entry), context)).toEqual([]);
    const settled = bill({ rate: 100, listRate: 100, paid: 236, status: 'SETTLED' });
    expect(verifyOutbox(outbox(settled.entry), context)).toEqual([]);
  });

  it("holds a cashier's bill to the discount limit, not an admin's", () => {
    // 80 against a list price of 100 is 20% off, over the 10% a cashier may give.
    const cut = bill({ rate: 80, listRate: 100, paid: 0, status: 'DRAFT' });
    expect(verifyOutbox(outbox(cut.entry), context)).toEqual([
      { document: 'Invoice MAI/1/26/00001', problem: expect.stringMatching(/more than the 10% a cashier may give/) }
    ]);
    const byAdmin = bill({ rate: 80, listRate: 100, paid: 0, status: 'DRAFT', createdBy: 'admin-1' });
    expect(verifyOutbox(outbox(byAdmin.entry), context)).toEqual([]);
  });

  it('wants the status its payments give', () => {
    const wrong = bill({ rate: 100, listRate: 100, paid: 100, status: 'SETTLED' });
    expect(verifyOutbox(outbox(wrong.entry), context)).toEqual([
      { document: 'Invoice MAI/1/26/00001', problem: expect.stringMatching(/marked settled though its payments say otherwise/) }
    ]);
  });
});
