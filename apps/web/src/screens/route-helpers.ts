import { redirect } from '@tanstack/react-router';
import { getSession } from '../lib/session';

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
