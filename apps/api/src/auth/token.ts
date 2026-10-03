import { createHmac, timingSafeEqual } from 'crypto';
import { UserRole } from '@prisma/client';
import type { SessionUser } from '../common/types';
import { currentBusiness } from '../tenancy/tenant-context';

type TokenPayload = {
  sub: string;
  role: UserRole;
  /** Hosted server: the business the user belongs to. */
  bid?: string;
  branchId?: string;
  registerId?: string;
  iat: number;
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

function getTtlSeconds() {
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
    exp: now + getTtlSeconds()
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
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
    registerId: payload.registerId || undefined
  };
}

type AccountPayload = { kind: 'account'; sub: string; iat: number; exp: number };

/** A business owner's token (hosted server): manages their businesses, never sells. */
export function signAccountToken(accountId: string) {
  const now = Math.floor(Date.now() / 1000);
  const payload: AccountPayload = { kind: 'account', sub: accountId, iat: now, exp: now + getTtlSeconds() };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

/** The account id of a valid owner token, or null. Staff tokens are not accepted. */
export function verifyAccountToken(token: string) {
  const [body, signature, ...rest] = token.split('.');
  if (!body || !signature || rest.length > 0) return null;
  const expected = Buffer.from(sign(body));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AccountPayload;
    if (payload.kind !== 'account' || typeof payload.sub !== 'string' || typeof payload.exp !== 'number') return null;
    return payload.exp > Math.floor(Date.now() / 1000) ? payload.sub : null;
  } catch {
    return null;
  }
}

export function readBearerToken(headers: Record<string, string | string[] | undefined>) {
  const authorization = headers.authorization;
  const authValue = Array.isArray(authorization) ? authorization[0] : authorization;
  if (!authValue || !authValue.startsWith('Bearer ')) {
    return null;
  }
  return authValue.slice('Bearer '.length).trim();
}
