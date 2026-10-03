import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MAX_COUNTERS_PER_BRANCH } from '@pos/contracts';
import { PrismaService } from '../prisma.service';
import type { SessionUser } from '../common/types';
import { requireAdmin } from '../common/request-session';
import { BranchesService } from '../branches/branches.service';
import { SettingsService } from '../settings/settings.service';
import { lockBranchRegisters } from '../common/counters';
import { assertOfflineRoomFor } from '../common/offline-limits';

export const counterSelect = { id: true, branchId: true, number: true, name: true, isActive: true, fallbackDeviceId: true } as const;

@Injectable()
export class CountersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly branches: BranchesService
  ) {}

  /** Anyone with access to the branch can see its counters; inactive ones only on request. */
  async listCounters(session: SessionUser, branchId: string, includeInactive: boolean) {
    await this.settings.ensureBranchExists(branchId);
    await this.branches.ensureUserHasBranchAccess(session.userId, branchId);
    return this.prisma.counter.findMany({
      where: { branchId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: { number: 'asc' },
      select: counterSelect
    });
  }

  /** A new counter takes the branch's next number, which gives it its own invoice and credit note series. */
  async createCounter(session: SessionUser, branchId: string, name: string) {
    requireAdmin(session);
    await this.settings.ensureBranchExists(branchId);
    await this.branches.ensureUserHasBranchAccess(session.userId, branchId);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockBranchRegisters(tx, branchId);
        await assertOfflineRoomFor(tx, 'counter');
        await this.assertNameFree(tx, branchId, name);
        // Numbers are never reused, so a deactivated counter's series stays its own.
        const last = await tx.counter.aggregate({ where: { branchId }, _max: { number: true } });
        const number = (last._max.number ?? 0) + 1;
        if (number > MAX_COUNTERS_PER_BRANCH) {
          throw new BadRequestException(`A branch can have at most ${MAX_COUNTERS_PER_BRANCH} counters`);
        }
        return tx.counter.create({ data: { branchId, number, name: name.trim() }, select: counterSelect });
      });
    } catch (error) {
      throw this.duplicateName(error);
    }
  }

  async updateCounter(session: SessionUser, counterId: string, input: { name?: string; isActive?: boolean }) {
    requireAdmin(session);
    const counter = await this.prisma.counter.findUnique({ where: { id: counterId }, select: counterSelect });
    if (!counter) {
      throw new NotFoundException('Counter not found');
    }
    await this.branches.ensureUserHasBranchAccess(session.userId, counter.branchId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Same lock as opening a register, so a register can't open while this is checked.
        await lockBranchRegisters(tx, counter.branchId);
        if (input.name !== undefined) {
          await this.assertNameFree(tx, counter.branchId, input.name, counterId);
        }
        if (input.isActive === false && counter.isActive) {
          const open = await tx.registerSession.findFirst({
            where: { counterId, closedAt: null },
            select: { user: { select: { username: true } } }
          });
          if (open) {
            throw new BadRequestException(`${counter.name} is open (by ${open.user.username}). Close its register first.`);
          }
          const othersActive = await tx.counter.count({ where: { branchId: counter.branchId, isActive: true, id: { not: counterId } } });
          if (othersActive === 0) {
            throw new BadRequestException('A branch needs at least one active counter');
          }
        }
        return tx.counter.update({
          where: { id: counterId },
          data: {
            ...(input.name !== undefined ? { name: input.name.trim() } : {}),
            ...(input.isActive !== undefined ? { isActive: input.isActive } : {})
          },
          select: counterSelect
        });
      });
    } catch (error) {
      throw this.duplicateName(error);
    }
  }

  /** Names are compared ignoring case, so "Counter 2" and "counter 2" can't both exist. */
  private async assertNameFree(tx: Prisma.TransactionClient, branchId: string, name: string, exceptId?: string) {
    const clash = await tx.counter.findFirst({
      where: { branchId, name: { equals: name.trim(), mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true }
    });
    if (clash) {
      throw new BadRequestException('This branch already has a counter with that name');
    }
  }

  private duplicateName(error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new BadRequestException('This branch already has a counter with that name');
    }
    return error;
  }
}
