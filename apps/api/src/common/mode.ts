import { CanActivate, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { PosMode } from '@pos/contracts';

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

/** The most an offline install may have; moving online lifts both. */
export const OFFLINE_LIMITS = { branches: 1, counters: 1 } as const;

export const MOVE_ONLINE_HINT = 'Move your business online to add more.';

export function offlineLimitError(what: string) {
  return new ForbiddenException(`Single-counter businesses can't ${what}. ${MOVE_ONLINE_HINT}`);
}

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
