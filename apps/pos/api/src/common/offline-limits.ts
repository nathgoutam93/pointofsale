import type { Prisma } from '@prisma/client';
import { isOffline, OFFLINE_LIMITS, offlineLimitError } from './mode';
import { lockBusiness } from './locks';

/**
 * Offline installs have one branch and one counter. Call inside the transaction that
 * creates one; the lock stops two requests from both seeing room for it.
 */
export async function assertOfflineRoomFor(tx: Prisma.TransactionClient, kind: 'branch' | 'counter') {
  if (!isOffline()) return;
  await lockBusiness(tx, 'offline-limits');
  if (kind === 'branch' && (await tx.branch.count()) >= OFFLINE_LIMITS.branches) {
    throw offlineLimitError('add branches');
  }
  if (kind === 'counter' && (await tx.counter.count()) >= OFFLINE_LIMITS.counters) {
    throw offlineLimitError('add counters');
  }
}
