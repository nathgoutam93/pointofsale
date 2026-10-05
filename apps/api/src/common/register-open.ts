import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { SessionUser } from './types';
import { requireSessionRegisterId } from './session';

/**
 * Money moving through a register must land before it closes: share-locks the session's
 * register row (closing takes it exclusively) and fails unless it is still open. Returns the
 * counter it runs on.
 */
export async function assertRegisterOpen(tx: Prisma.TransactionClient, session: SessionUser) {
  const registerId = requireSessionRegisterId(session);
  const rows = await tx.$queryRaw<Array<{ closedAt: Date | null; counterId: string }>>`
    SELECT "closedAt", "counterId" FROM "RegisterSession" WHERE id = ${registerId} FOR SHARE`;
  if (rows.length === 0 || rows[0].closedAt !== null) {
    throw new BadRequestException('Register is closed. Open a register to continue.');
  }
  return { counterId: rows[0].counterId };
}
