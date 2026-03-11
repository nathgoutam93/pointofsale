import { redirect } from '@tanstack/react-router';
import { getSession, Session } from '../lib/session';

export function money(n: number | string | null | undefined) {
  const value = Number(n);
  if (!Number.isFinite(value)) return '0.00';
  return value.toFixed(2);
}

export function requireSession() {
  const session = getSession();
  if (!session) {
    throw redirect({ to: '/' });
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
