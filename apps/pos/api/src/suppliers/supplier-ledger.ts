import { round2 } from '../common/numbers';

export type LedgerPurchase = {
  id: string;
  purchaseNo: string;
  supplierInvoiceNo: string | null;
  /** The supplier invoice's date, else the day received (YYYY-MM-DD). */
  date: string;
  dueDate: string | null;
  grandTotal: number;
  createdAt: Date;
  settledBeforeAccounts: boolean;
};
export type LedgerReturn = { id: string; returnNo: string; purchaseId: string; totalAmount: number; createdAt: Date };
export type LedgerPayment = { id: string; amount: number; mode: string; reference: string | null; createdAt: Date };

/** A day's date (YYYY-MM-DD) `days` later. */
export function addDays(date: string, days: number) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * A supplier's account. Purchases add what they owe (those recorded before supplier accounts
 * count as paid and stay out); goods sent back and payments take it off. Each return comes off
 * its own purchase first; payments, and returns beyond what their purchase owes, pay the oldest
 * bills first. A bill is overdue once its due date has passed (`today`, YYYY-MM-DD).
 */
export function supplierLedger(input: { purchases: LedgerPurchase[]; returns: LedgerReturn[]; payments: LedgerPayment[]; today: string }) {
  const counted = input.purchases.filter((purchase) => !purchase.settledBeforeAccounts);
  const purchaseNoById = new Map(input.purchases.map((purchase) => [purchase.id, purchase.purchaseNo]));

  const movements = [
    ...counted.map((purchase) => ({ kind: 'PURCHASE' as const, id: purchase.id, reference: purchase.supplierInvoiceNo ? `${purchase.purchaseNo} (bill ${purchase.supplierInvoiceNo})` : purchase.purchaseNo, at: purchase.createdAt, change: purchase.grandTotal })),
    ...input.returns.map((entry) => ({ kind: 'RETURN' as const, id: entry.id, reference: `${entry.returnNo} against ${purchaseNoById.get(entry.purchaseId) ?? 'a purchase'}`, at: entry.createdAt, change: -entry.totalAmount })),
    ...input.payments.map((payment) => ({ kind: 'PAYMENT' as const, id: payment.id, reference: payment.reference ? `${payment.mode} ${payment.reference}` : payment.mode, at: payment.createdAt, change: -payment.amount }))
  ].sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id));
  let balance = 0;
  const entries = movements.map((movement) => {
    balance = round2(balance + movement.change);
    return { kind: movement.kind, id: movement.id, reference: movement.reference, date: movement.at.toISOString(), amount: round2(Math.abs(movement.change)), balance };
  });

  // What each bill still owes after its own returns; the rest is credit for the oldest bills.
  const returnedByPurchase = new Map<string, number>();
  for (const entry of input.returns) returnedByPurchase.set(entry.purchaseId, round2((returnedByPurchase.get(entry.purchaseId) ?? 0) + entry.totalAmount));
  let credit = round2(input.payments.reduce((sum, payment) => sum + payment.amount, 0));
  const settledIds = new Set(input.purchases.filter((purchase) => purchase.settledBeforeAccounts).map((purchase) => purchase.id));
  for (const [purchaseId, amount] of returnedByPurchase) if (settledIds.has(purchaseId)) credit = round2(credit + amount);

  const bills = [...counted]
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.getTime() - b.createdAt.getTime())
    .map((purchase) => {
      const returned = returnedByPurchase.get(purchase.id) ?? 0;
      credit = round2(credit + Math.max(0, returned - purchase.grandTotal));
      return { purchase, owed: round2(Math.max(0, purchase.grandTotal - returned)) };
    });
  const openBills = [];
  let overdue = 0;
  for (const bill of bills) {
    const paid = Math.min(credit, bill.owed);
    credit = round2(credit - paid);
    const outstanding = round2(bill.owed - paid);
    if (outstanding <= 0) continue;
    const isOverdue = !!bill.purchase.dueDate && bill.purchase.dueDate < input.today;
    if (isOverdue) overdue = round2(overdue + outstanding);
    openBills.push({
      purchaseId: bill.purchase.id,
      purchaseNo: bill.purchase.purchaseNo,
      supplierInvoiceNo: bill.purchase.supplierInvoiceNo,
      date: bill.purchase.date,
      dueDate: bill.purchase.dueDate,
      total: bill.purchase.grandTotal,
      outstanding,
      overdue: isOverdue
    });
  }
  return { balance, overdue, openBills, entries };
}
