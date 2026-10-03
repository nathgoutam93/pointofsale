import { createHmac, timingSafeEqual } from 'crypto';
import { UserRole } from '@prisma/client';
import type { SessionUser } from '../common/types';
import { currentBusiness } from '../tenancy/tenant-context';
import { sessionCookieToken } from './session-cookie';

type TokenPayload = {
  sub: string;
  role: UserRole;
  /** Hosted server: the business the user belongs to. */
  bid?: string;
  branchId?: string;
  registerId?: string;
  iat: number;
  /** iat in milliseconds, to tell a session from a password change made the same second. */
  iatMs?: number;
  exp: number;
};

const DEFAULT_TTL_HOURS = 12;

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('AUTH_SECRET must be set to at least 32 characters');
  }
  return secret;
}

export function tokenTtlSeconds() {
  const hours = Number(process.env.AUTH_TOKEN_TTL_HOURS ?? DEFAULT_TTL_HOURS);
  return Math.round((Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_TTL_HOURS) * 3600);
}

function sign(data: string) {
  return createHmac('sha256', getSecret()).update(data).digest('base64url');
}

/** Fails fast at startup instead of on the first login. */
export function assertAuthConfigured() {
  getSecret();
}

export function signToken(session: SessionUser) {
  const now = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = {
    sub: session.userId,
    role: session.role,
    // Staff tokens are for one business: the one this request is for.
    bid: currentBusiness()?.id ?? session.businessId,
    branchId: session.branchId,
    registerId: session.registerId,
    iat: now,
    iatMs: Date.now(),
    exp: now + tokenTtlSeconds()
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

/** When a token was signed, in milliseconds (older tokens carry seconds only). */
const issuedAtMs = (payload: { iat?: unknown; iatMs?: unknown }) =>
  typeof payload.iatMs === 'number' ? payload.iatMs : typeof payload.iat === 'number' ? payload.iat * 1000 : 0;

/** A token signed before the password changed. */
export function signedBeforePasswordChange(issuedAt: number | undefined, changedAt: Date | null) {
  return !!changedAt && (issuedAt ?? 0) < changedAt.getTime();
}

/** Returns the session for a valid, unexpired token, or null. */
export function verifyToken(token: string): SessionUser | null {
  const [body, signature, ...rest] = token.split('.');
  if (!body || !signature || rest.length > 0) {
    return null;
  }

  const expected = Buffer.from(sign(body));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number') {
    return null;
  }
  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    return null;
  }
  if (payload.role !== UserRole.ADMIN && payload.role !== UserRole.CASHIER) {
    return null;
  }
  if (payload.registerId && !payload.branchId) {
    return null;
  }

  return {
    userId: payload.sub,
    role: payload.role,
    businessId: typeof payload.bid === 'string' ? payload.bid : undefined,
    branchId: payload.branchId || undefined,
    registerId: payload.registerId || undefined,
    issuedAt: issuedAtMs(payload)
  };
}

type AccountPayload = { kind: 'account'; sub: string; iat: number; iatMs?: number; exp: number };

/** A business owner's token (hosted server): manages their businesses, never sells. */
export function signAccountToken(accountId: string) {
  const now = Math.floor(Date.now() / 1000);
  const payload: AccountPayload = { kind: 'account', sub: accountId, iat: now, iatMs: Date.now(), exp: now + tokenTtlSeconds() };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

/** The account and signing time of a valid owner token, or null. Staff tokens are not accepted. */
export function verifyAccountToken(token: string) {
  const [body, signature, ...rest] = token.split('.');
  if (!body || !signature || rest.length > 0) return null;
  const expected = Buffer.from(sign(body));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AccountPayload;
    if (payload.kind !== 'account' || typeof payload.sub !== 'string' || typeof payload.exp !== 'number') return null;
    return payload.exp > Math.floor(Date.now() / 1000) ? { accountId: payload.sub, issuedAt: issuedAtMs(payload) } : null;
  } catch {
    return null;
  }
}

/**
 * The request's sign-in token: `Authorization: Bearer …` (API clients, owner tokens), else the
 * session cookie of a web client that sent the cookie-session header (see SESSION_HEADER).
 */
export function readBearerToken(headers: Record<string, string | string[] | undefined>) {
  const authorization = headers.authorization;
  const authValue = Array.isArray(authorization) ? authorization[0] : authorization;
  if (authValue && authValue.startsWith('Bearer ')) {
    return authValue.slice('Bearer '.length).trim();
  }
  return sessionCookieToken(headers);
}
