import { beforeEach, describe, expect, it, vi } from 'vitest';
import { beginSettlement, finishSettlement, sendSettlement } from './pendingSettlement';

const payments = [{ mode: 'CASH', amount: 60 }];
const scope = JSON.stringify(['https://shop.example', 'cashier', 'invoice']);

beforeEach(() => localStorage.clear());

describe('settlement recovery', () => {
  it('reuses the payment ID after a lost answer and after reloading the page', async () => {
    const first = beginSettlement(localStorage, scope, payments).id;
    // A reload creates a new module instance; only browser storage survives.
    vi.resetModules();
    const reloaded = await import('./pendingSettlement');
    expect(reloaded.beginSettlement(localStorage, scope, payments).id).toBe(first);
    reloaded.finishSettlement(localStorage, scope, first);
    expect(reloaded.beginSettlement(localStorage, scope, payments).id).not.toBe(first);
  });

  it('refuses changed payment details while the outcome is unknown', () => {
    const first = beginSettlement(localStorage, scope, payments).id;
    expect(() => beginSettlement(localStorage, scope, [{ mode: 'CASH', amount: 61 }])).toThrow(/previous payment is not confirmed/);
    expect(() => beginSettlement(localStorage, scope, [{ mode: 'CARD', amount: 60 }])).toThrow(/previous payment is not confirmed/);
    expect(beginSettlement(localStorage, scope, payments).id).toBe(first);
  });

  it('keeps different invoices, cashiers and servers separate', () => {
    const first = beginSettlement(localStorage, scope, payments).id;
    for (const other of [['https://shop.example', 'cashier', 'other'], ['https://shop.example', 'other', 'invoice'], ['https://other.example', 'cashier', 'invoice']]) {
      expect(beginSettlement(localStorage, JSON.stringify(other), payments).id).not.toBe(first);
    }
  });

  it('does not let a delayed response erase a newer payment ID', () => {
    const first = beginSettlement(localStorage, scope, payments).id;
    finishSettlement(localStorage, scope, first);
    const next = beginSettlement(localStorage, scope, payments).id;
    finishSettlement(localStorage, scope, first);
    expect(beginSettlement(localStorage, scope, payments).id).toBe(next);
  });

  it('blocks payment if the retry ID cannot be saved or read', () => {
    const broken = {
      getItem: () => null,
      setItem: () => { throw new Error('Quota exceeded'); },
      removeItem: () => undefined
    };
    expect(() => beginSettlement(broken, scope, payments)).toThrow(/Cannot save/);
    broken.getItem = () => { throw new Error('Storage disabled'); };
    expect(() => beginSettlement(broken, scope, payments)).toThrow(/Cannot read/);
  });

  it('preserves a confirmed payment ID if cleanup fails', () => {
    const first = beginSettlement(localStorage, scope, payments).id;
    const broken = { getItem: localStorage.getItem.bind(localStorage), removeItem: () => { throw new Error('Storage disabled'); } };
    expect(() => finishSettlement(broken, scope, first)).not.toThrow();
    expect(beginSettlement(localStorage, scope, payments).id).toBe(first);
  });

  it('retains the original ID through a lost answer, a fallback rejection, and reconnection', async () => {
    let original = '';
    await expect(sendSettlement(localStorage, scope, payments, async (id) => {
      original = id;
      throw new Error('Response lost');
    })).rejects.toThrow('Response lost');
    // The bill is absent from the fallback snapshot. This does not prove that the online
    // payment failed; discarding the key here would allow a duplicate on reconnection.
    await sendSettlement(localStorage, scope, payments, async (id) => {
      expect(id).toBe(original);
      return { status: 404 };
    });
    await sendSettlement(localStorage, scope, payments, async (id) => {
      expect(id).toBe(original);
      return { status: 200 };
    });
    expect(beginSettlement(localStorage, scope, payments).id).not.toBe(original);
  });

  it('allows correcting a payment rejected on its first attempt', async () => {
    await sendSettlement(localStorage, scope, payments, async () => ({ status: 400 }));
    await expect(sendSettlement(localStorage, scope, [{ mode: 'CARD', amount: 50 }], async () => ({ status: 200 }))).resolves.toEqual({ status: 200 });
  });

  it('keeps payment details locked after a gateway timeout or server error', async () => {
    for (const status of [408, 500, 502, 504]) {
      const otherScope = `${scope}:${status}`;
      let original = '';
      await sendSettlement(localStorage, otherScope, payments, async (id) => { original = id; return { status }; });
      expect(beginSettlement(localStorage, otherScope, payments).id).toBe(original);
      expect(() => beginSettlement(localStorage, otherScope, [{ mode: 'CASH', amount: 61 }])).toThrow(/not confirmed/);
    }
  });
});
