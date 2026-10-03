import { CanActivate, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Hosting, PosMode } from '@pos/contracts';

/**
 * offline: a desktop install running on one machine, limited to one branch and one counter.
 * online: the hosted server (the default, so existing setups behave as before).
 */
export function posMode(): PosMode {
  const value = process.env.POS_MODE?.trim().toLowerCase() || 'online';
  if (value !== 'offline' && value !== 'online') {
    throw new Error(`POS_MODE must be "offline" or "online", not "${process.env.POS_MODE}"`);
  }
  return value;
}

export const isOffline = () => posMode() === 'offline';

/**
 * A fallback counter's local copy: the offline API on an online business's computer, selling
 * while the server can't be reached (POS_FALLBACK=1, with POS_FALLBACK_COUNTER_ID and the
 * POS_FALLBACK_SECRET the desktop app reads the offline sales with).
 */
export const isFallback = () => isOffline() && process.env.POS_FALLBACK === '1';
export const fallbackCounterId = () => process.env.POS_FALLBACK_COUNTER_ID?.trim() || null;

/** The most an offline install may have; moving online lifts both. */
export const OFFLINE_LIMITS = { branches: 1, counters: 1 } as const;

export const MOVE_ONLINE_HINT = 'Move your business online to add more.';

export function offlineLimitError(what: string) {
  return new ForbiddenException(`Single-counter businesses can't ${what}. ${MOVE_ONLINE_HINT}`);
}

/**
 * Online only: POS_HOSTING says whether this is our managed service (managed: sign-up and
 * subscriptions) or a business's own server (self, the default). The apps follow what the server
 * says, never its address. Offline: null.
 */
export function posHosting(): Hosting | null {
  if (isOffline()) return null;
  const value = process.env.POS_HOSTING?.trim().toLowerCase() || 'self';
  if (value !== 'managed' && value !== 'self') {
    throw new Error(`POS_HOSTING must be "managed" or "self", not "${process.env.POS_HOSTING}"`);
  }
  return value;
}

export const isManagedHosting = () => posHosting() === 'managed';

/** Online only: MIN_CLIENT_VERSION (x.y.z); clients older than this must update. */
export function minClientVersion(): string | null {
  if (isOffline()) return null;
  const value = process.env.MIN_CLIENT_VERSION?.trim();
  if (!value) return null;
  if (!/^\d+\.\d+\.\d+$/.test(value)) {
    throw new Error(`MIN_CLIENT_VERSION must look like 1.2.3, not "${value}"`);
  }
  return value;
}

/** For routes that exist only on offline installs: elsewhere they answer 404, before validation runs. */
@Injectable()
export class OfflineOnlyGuard implements CanActivate {
  canActivate() {
    if (!isOffline()) {
      throw new NotFoundException();
    }
    return true;
  }
}

/** For routes that exist only on the hosted server: offline they answer 404. */
@Injectable()
export class OnlineOnlyGuard implements CanActivate {
  canActivate() {
    if (isOffline()) {
      throw new NotFoundException();
    }
    return true;
  }
}
