import { SETTLEMENT_NOT_RECORDED } from '@pos/contracts';

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Payment = { mode: string; amount: number; tendered?: number; reference?: string };
type Pending = { id: string; fingerprint: string };

const storageKey = (scope: string) => `pos_pending_settlement:${scope}`;

/** Persist before sending: a lost answer or page reload must reuse the same payment ID. */
export function beginSettlement(storage: Storage, scope: string, payments: Payment[]): { id: string; retrying: boolean } {
  const fingerprint = JSON.stringify(payments.map((p) => ({
    mode: p.mode, amount: p.amount, tendered: p.tendered ?? null, reference: p.reference ?? null
  })));
  let pending: Pending | null;
  try {
    const saved = storage.getItem(storageKey(scope));
    pending = saved ? JSON.parse(saved) : null;
    if (pending && (typeof pending.id !== 'string' || typeof pending.fingerprint !== 'string')) throw new Error();
  } catch {
    throw new Error('Cannot read the pending payment. Restore browser storage before taking payment.');
  }
  if (pending) {
    if (pending.fingerprint !== fingerprint) {
      throw new Error(`The previous payment (${describePayments(pending.fingerprint)}) is not confirmed. Retry it with the same payment details before changing the amount or payment method.`);
    }
    return { id: pending.id, retrying: true };
  }
  const id = crypto.randomUUID();
  try {
    storage.setItem(storageKey(scope), JSON.stringify({ id, fingerprint }));
  } catch {
    throw new Error('Cannot save the payment retry ID. Restore browser storage before taking payment.');
  }
  return { id, retrying: false };
}

/** The payments a saved fingerprint stands for, e.g. "₹500.00 CASH + ₹100.00 UPI". */
function describePayments(fingerprint: string) {
  try {
    const payments = JSON.parse(fingerprint) as Array<{ mode: string; amount: number }>;
    return payments.map((p) => `₹${Number(p.amount).toFixed(2)} ${p.mode}`).join(' + ');
  } catch {
    return 'unknown details';
  }
}

/** A retry may reach the fallback API before its original server payment has synced. Even a
 * rejection there cannot establish the original outcome, so a failed retry keeps the ID unless
 * the online server says it recorded nothing under it (SETTLEMENT_NOT_RECORDED). */
export async function sendSettlement<R extends { status: number; body?: unknown }>(
  storage: Storage, scope: string, payments: Payment[], send: (id: string) => Promise<R>
): Promise<R> {
  const pending = beginSettlement(storage, scope, payments);
  const response = await send(pending.id);
  const notRecorded = !!response.body && typeof response.body === 'object' && (response.body as { code?: unknown }).code === SETTLEMENT_NOT_RECORDED;
  if (response.status === 200 || notRecorded || (!pending.retrying && [400, 403, 404, 422, 426, 429].includes(response.status))) {
    finishSettlement(storage, scope, pending.id);
  }
  return response;
}

/** Only clear the operation we sent; failure to clear must not hide a confirmed payment. */
export function finishSettlement(storage: Pick<Storage, 'getItem' | 'removeItem'>, scope: string, id: string) {
  try {
    const saved = storage.getItem(storageKey(scope));
    if (saved && (JSON.parse(saved) as Pending).id === id) storage.removeItem(storageKey(scope));
  } catch {
    // Leaving the ID is safe: the next attempt replays the confirmed receipt.
  }
}
