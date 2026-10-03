import type { Prisma } from '@prisma/client';

/**
 * Holds a lock named `name` until the transaction ends. Advisory locks are shared by the
 * whole database, so the key includes the current schema: on a server holding one schema
 * per business, businesses never wait on each other's locks.
 */
export async function lockBusiness(tx: Prisma.TransactionClient, name: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(current_schema() || ':' || ${name}, 0))`;
}
