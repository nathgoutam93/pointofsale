import { redirect } from '@tanstack/react-router';
import type { CashierPermission } from '@pos/contracts';
import { can, getSession, Session } from '../lib/session';

export function money(n: number | string | null | undefined) {
  const value = Number(n);
  if (!Number.isFinite(value)) return '0.00';
  return value.toFixed(2);
}

const inrFormat = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** An amount for display: `₹1,47,140.42`. Use `money` for receipts and input values. */
export function inr(n: number | string | null | undefined) {
  const value = Number(n);
  const safe = Number.isFinite(value) ? value : 0;
  return `${safe < 0 ? '-' : ''}₹${inrFormat.format(Math.abs(safe))}`;
}

export function requireSession() {
  const session = getSession();
  if (!session) {
    throw redirect({ to: '/' });
  }
  if (session.mustChangePassword) {
    throw redirect({ to: '/change-password' });
  }
  return session;
}

export function requireOperationalSession() {
  const session = requireSession();
  if (!session.branchId || !session.registerId) {
    throw redirect({ to: '/open-register' });
  }
  return session as Session & { branchId: string; registerId: string };
}

export function requireAdmin() {
  const session = requireSession();
  if (session.role !== 'ADMIN') {
    throw redirect({ to: '/pos' });
  }
  return session;
}

/**
 * Screens that manage a branch (inventory, customers, sales history, purchases, transfers):
 * admins use them for any branch they have access to, register or not; cashiers at the branch
 * of their open register.
 */
export function requireManagementSession() {
  const session = requireSession();
  if (session.role === 'ADMIN') return session;
  return requireOperationalSession();
}

/** A screen only for those allowed to `permission` (admins always). */
export function requirePermission(permission: CashierPermission) {
  const session = requireSession();
  if (!can(session, permission)) {
    throw redirect({ to: '/pos' });
  }
  return session;
}

/** A cost as shown: "—" when the user may not see costs (the API sends none). */
export function costLabel(value: number | string | null | undefined) {
  return value === null || value === undefined ? '—' : inr(value);
}
