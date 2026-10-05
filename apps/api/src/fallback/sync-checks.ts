import { Prisma, UserRole } from '@prisma/client';
import { toNumber } from '../common/numbers';
import type { FallbackOutbox, SyncConflict } from './fallback.service';
import type { ServerSaleLine } from './verify-outbox';

/**
 * What the server looks up before it takes a fallback counter's offline sales, inside the sync's
 * transaction: clashes with what it already has, and what verifyOutbox needs to check the rest.
 */

/** What verifyOutbox needs from the server: the business's settings, staff roles, and bills it already had. */
export async function verificationContext(
  tx: Prisma.TransactionClient,
  outbox: FallbackOutbox,
  returns: NonNullable<FallbackOutbox['returns']>
) {
  const business = await tx.businessSettings.findUnique({
    where: { id: 'default' },
    select: { taxCalculationMode: true, cashierMaxDiscountPercent: true }
  });
  const staffIds = [...new Set(outbox.invoices.map((entry) => String(entry.invoice.createdBy)))];
  const admins = new Set(
    (await tx.user.findMany({ where: { id: { in: staffIds }, role: UserRole.ADMIN }, select: { id: true } })).map((user) => user.id)
  );
  const cashierLimit = toNumber(business?.cashierMaxDiscountPercent ?? 10);

  // Lines of bills the server had (the copy's), with what returns other than these took from them.
  const outboxInvoiceIds = new Set(outbox.invoices.map((entry) => String(entry.invoice.id)));
  const returnIds = returns.map((entry) => String(entry.ret.id));
  const serverBillIds = [...new Set(returns.map((entry) => String(entry.ret.saleInvoiceId)))].filter((id) => !outboxInvoiceIds.has(id));
  const serverLines = serverBillIds.length
    ? await tx.saleInvoiceLine.findMany({
        where: { invoiceId: { in: serverBillIds } },
        select: {
          id: true,
          itemId: true,
          itemName: true,
          qty: true,
          taxableAmount: true,
          cgstAmount: true,
          sgstAmount: true,
          igstAmount: true,
          invoice: { select: { invoiceNo: true } },
          returnLines: {
            where: { returnInvoiceId: { notIn: returnIds } },
            select: { qty: true, taxableAmount: true, cgstAmount: true, sgstAmount: true, igstAmount: true }
          }
        }
      })
    : [];
  const serverSaleLines = new Map<string, ServerSaleLine>(
    serverLines.map((line) => {
      const total = (pick: (row: (typeof line.returnLines)[number]) => Prisma.Decimal) => line.returnLines.reduce((sum, row) => sum + toNumber(pick(row)), 0);
      return [
        line.id,
        {
          id: line.id,
          invoiceNo: line.invoice.invoiceNo,
          itemId: line.itemId,
          itemName: line.itemName,
          qty: toNumber(line.qty),
          taxable: toNumber(line.taxableAmount),
          cgst: toNumber(line.cgstAmount),
          sgst: toNumber(line.sgstAmount),
          igst: toNumber(line.igstAmount),
          returned: {
            qty: total((row) => row.qty),
            taxable: total((row) => row.taxableAmount),
            cgst: total((row) => row.cgstAmount),
            sgst: total((row) => row.sgstAmount),
            igst: total((row) => row.igstAmount)
          }
        }
      ];
    })
  );
  return {
    taxCalculationMode: business?.taxCalculationMode ?? 'AFTER_DISCOUNT',
    maxDiscountPercentFor: (userId: string) => (admins.has(userId) ? null : cashierLimit),
    serverSaleLines
  };
}

/**
 * What would stop the offline sales going in as they are: an invoice, receipt or return number
 * the server has already used for something else; an item, customer or staff member they point
 * at that the server no longer has; or goods returned offline that were also returned online.
 * Rows already added (a retry) are not clashes.
 */
export async function syncConflicts(
  tx: Prisma.TransactionClient,
  outbox: FallbackOutbox & { returns: NonNullable<FallbackOutbox['returns']> },
  addedCustomers: Set<string>
): Promise<SyncConflict[]> {
  const timezone = (await tx.businessSettings.findUnique({ where: { id: 'default' }, select: { timezone: true } }))?.timezone ?? 'Asia/Kolkata';
  const when = (date: Date) => date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone });
  const conflicts: SyncConflict[] = [];
  const ids = (rows: Array<Record<string, unknown>>) => rows.map((row) => String(row.id));
  const invoiceNoOf = new Map(outbox.invoices.map((entry) => [String(entry.invoice.id), String(entry.invoice.invoiceNo)]));

  const invoices = outbox.invoices.map((entry) => entry.invoice);
  const takenInvoices = await tx.saleInvoice.findMany({
    where: { invoiceNo: { in: invoices.map((row) => String(row.invoiceNo)) }, id: { notIn: ids(invoices) } },
    select: { invoiceNo: true, createdAt: true }
  });
  for (const taken of takenInvoices) {
    conflicts.push({
      document: `Invoice ${taken.invoiceNo}`,
      problem: `This number was also used online (${when(taken.createdAt)}), for another sale.`
    });
  }

  const receipts = outbox.invoices.flatMap((entry) => entry.receipts);
  const takenReceipts = await tx.receipt.findMany({
    where: { receiptNo: { in: receipts.map((row) => String(row.receiptNo)) }, id: { notIn: ids(receipts) } },
    select: { receiptNo: true, createdAt: true }
  });
  for (const taken of takenReceipts) {
    conflicts.push({
      document: `Receipt ${taken.receiptNo}`,
      problem: `This number was also used online (${when(taken.createdAt)}), for another payment.`
    });
  }

  const missing = async (model: 'item' | 'customer' | 'user', wanted: string[]) => {
    const unique = [...new Set(wanted)];
    if (unique.length === 0) return new Set<string>();
    const where = { id: { in: unique } };
    const found =
      model === 'item'
        ? await tx.item.findMany({ where, select: { id: true } })
        : model === 'customer'
          ? await tx.customer.findMany({ where, select: { id: true } })
          : await tx.user.findMany({ where, select: { id: true } });
    const present = new Set(found.map((row) => row.id));
    return new Set(unique.filter((id) => !present.has(id)));
  };
  const lines = outbox.invoices.flatMap((entry) => entry.lines);
  const missingItems = await missing('item', [...lines, ...outbox.invoices.flatMap((entry) => entry.ledger)].map((row) => String(row.itemId)));
  for (const row of lines.filter((line) => missingItems.has(String(line.itemId)))) {
    conflicts.push({
      document: `Invoice ${invoiceNoOf.get(String(row.invoiceId))}`,
      problem: `Its item "${String(row.itemName)}" is no longer on the server.`
    });
  }
  const missingCustomers = await missing('customer', invoices.map((row) => String(row.customerId)).filter((id) => !addedCustomers.has(id)));
  for (const row of invoices.filter((invoice) => missingCustomers.has(String(invoice.customerId)))) {
    conflicts.push({ document: `Invoice ${String(row.invoiceNo)}`, problem: `Its customer "${String(row.customerName)}" is no longer on the server.` });
  }
  const returns = outbox.returns.map((entry) => entry.ret);
  const takenReturns = await tx.returnInvoice.findMany({
    where: { returnNo: { in: returns.map((row) => String(row.returnNo)) }, id: { notIn: ids(returns) } },
    select: { returnNo: true, createdAt: true }
  });
  for (const taken of takenReturns) {
    conflicts.push({ document: `Return ${taken.returnNo}`, problem: `This number was also used online (${when(taken.createdAt)}), for another return.` });
  }
  // Returns of bills the server already had (the copy's): not more than was sold, nor more
  // money back than was paid, counting what was returned online meanwhile.
  const already = new Set((await tx.returnInvoice.findMany({ where: { id: { in: ids(returns) } }, select: { id: true } })).map((row) => row.id));
  const offline = outbox.returns.filter((entry) => !already.has(String(entry.ret.id)) && !invoiceNoOf.has(String(entry.ret.saleInvoiceId)));
  const billIds = [...new Set(offline.map((entry) => String(entry.ret.saleInvoiceId)))];
  if (billIds.length) {
    const bills = await tx.saleInvoice.findMany({
      where: { id: { in: billIds } },
      select: {
        id: true,
        invoiceNo: true,
        grandTotal: true,
        paidTotal: true,
        lines: { select: { id: true, itemName: true, qty: true, returnLines: { select: { qty: true } } } },
        returns: { select: { refundAmount: true } }
      }
    });
    for (const bill of bills) {
      const mine = offline.filter((entry) => entry.ret.saleInvoiceId === bill.id);
      const returnNos = mine.map((entry) => String(entry.ret.returnNo)).join(', ');
      if (mine.some((entry) => Number(entry.ret.dueAdjusted ?? 0) > 0)) {
        conflicts.push({ document: `Return ${returnNos}`, problem: `It lowers what is owed on ${bill.invoiceNo}, which can't be done offline.` });
      }
      for (const line of bill.lines) {
        const online = line.returnLines.reduce((sum, row) => sum + toNumber(row.qty), 0);
        const offlineQty = mine.flatMap((entry) => entry.lines).filter((row) => row.saleLineId === line.id).reduce((sum, row) => sum + Number(row.qty ?? 0), 0);
        if (offlineQty > 0 && online + offlineQty > toNumber(line.qty) + 1e-9) {
          conflicts.push({
            document: `Return ${returnNos}`,
            problem: `More "${line.itemName}" would be returned on ${bill.invoiceNo} than was sold: some were also returned online.`
          });
        }
      }
      const refunded = bill.returns.reduce((sum, row) => sum + toNumber(row.refundAmount), 0) + mine.reduce((sum, entry) => sum + Number(entry.ret.refundAmount ?? 0), 0);
      if (refunded > Math.min(toNumber(bill.paidTotal), toNumber(bill.grandTotal)) + 0.005) {
        conflicts.push({ document: `Return ${returnNos}`, problem: `More money would be handed back on ${bill.invoiceNo} than was paid for it.` });
      }
    }
  }

  const missingUsers = await missing('user', outbox.registers.map((row) => String(row.userId)));
  for (const row of outbox.registers.filter((register) => missingUsers.has(String(register.userId)))) {
    conflicts.push({
      document: `The register opened ${when(new Date(String(row.openedAt)))}`,
      problem: 'The staff member who opened it is no longer on the server.'
    });
  }
  return conflicts;
}
