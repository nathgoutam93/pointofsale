import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { SessionUser } from './types';

export type AuditInput = {
  action: string;
  entityType: string;
  entityId?: string | null;
  branchId?: string | null;
  summary: string;
  details?: Prisma.InputJsonValue;
};

/**
 * The audit log: who changed what, and when. Written in the same transaction as the change when
 * one is given, so a change that is rolled back leaves no entry. Entries are never edited.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(session: SessionUser, event: AuditInput, client?: Prisma.TransactionClient) {
    const db = client ?? this.prisma;
    const user = await db.user.findUnique({ where: { id: session.userId }, select: { username: true } });
    await db.auditEvent.create({
      data: {
        userId: session.userId,
        userName: user?.username ?? 'Unknown',
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId ?? null,
        branchId: event.branchId ?? null,
        summary: event.summary,
        details: event.details ?? Prisma.JsonNull
      }
    });
  }

  /** The fields of `after` that differ from `before`, as { field: [before, after] }. */
  static changes(before: Record<string, unknown>, after: Record<string, unknown>, fields: string[]) {
    const changed: Record<string, [unknown, unknown]> = {};
    const plain = (value: unknown) => (value instanceof Prisma.Decimal ? Number(value) : value);
    for (const field of fields) {
      const a = plain(before[field]);
      const b = plain(after[field]);
      if (JSON.stringify(a) !== JSON.stringify(b)) changed[field] = [a ?? null, b ?? null];
    }
    return changed;
  }

  /** The newest entries first, `limit` at a time, before `before` (a createdAt) when given. */
  list(input: { branchIds: string[]; action?: string; entityType?: string; before?: Date; limit: number }) {
    return this.prisma.auditEvent.findMany({
      where: {
        OR: [{ branchId: null }, { branchId: { in: input.branchIds } }],
        ...(input.action ? { action: input.action } : {}),
        ...(input.entityType ? { entityType: input.entityType } : {}),
        ...(input.before ? { createdAt: { lt: input.before } } : {})
      },
      orderBy: { createdAt: 'desc' },
      take: input.limit
    });
  }
}
