import type { Prisma } from '@prisma/client';

/** The counter every new branch starts with. */
export const DEFAULT_COUNTER_NAME = 'Counter 1';

/**
 * Holds a lock per branch until the transaction ends. Opening a register and deactivating a
 * counter both take it, so neither can race the other (or a second open on the same counter).
 */
export async function lockBranchRegisters(tx: Prisma.TransactionClient, branchId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`register:${branchId}`}, 0))`;
}
