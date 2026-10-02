import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { hashPassword, validateNewPassword } from '../auth/password';
import type { SessionUser } from '../common/types';
import { SettingsService } from '../settings/settings.service';
import { BranchesService } from '../branches/branches.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly branches: BranchesService
  ) {}

  async listUsers(branchId: string) {
    await this.settings.ensureBranchExists(branchId);
    const users = await this.prisma.user.findMany({
      where: { branchAccesses: { some: { branchId } } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        username: true,
        role: true,
        branchId: true,
        isActive: true,
        createdAt: true,
        branchAccesses: { select: { branchId: true } }
      }
    });
    return users.map((user) => ({
      id: user.id,
      username: user.username,
      role: user.role,
      branchId: user.branchId,
      branchIds: user.branchAccesses.map((access) => access.branchId),
      isActive: user.isActive,
      createdAt: user.createdAt
    }));
  }

  async createUser(
    branchId: string,
    input: { username: string; password: string; role?: UserRole; branchIds?: string[] }
  ) {
    await this.settings.ensureBranchExists(branchId);
    if (input.role && input.role !== UserRole.CASHIER) {
      throw new BadRequestException('Only cashier accounts can be created here');
    }
    const passwordError = validateNewPassword(input.password);
    if (passwordError) {
      throw new BadRequestException(passwordError);
    }
    const uniqueBranchIds = Array.from(new Set([branchId, ...(input.branchIds ?? [])]));
    await Promise.all(uniqueBranchIds.map((id) => this.settings.ensureBranchExists(id)));
    const created = await this.prisma.user.create({
      data: {
        branchId,
        username: input.username,
        password: await hashPassword(input.password),
        role: UserRole.CASHIER,
        branchAccesses: {
          createMany: {
            data: uniqueBranchIds.map((id) => ({ branchId: id }))
          }
        }
      },
      select: {
        id: true,
        username: true,
        role: true,
        branchId: true,
        isActive: true,
        createdAt: true,
        branchAccesses: { select: { branchId: true } }
      }
    });
    return {
      id: created.id,
      username: created.username,
      role: created.role,
      branchId: created.branchId,
      branchIds: created.branchAccesses.map((access) => access.branchId),
      isActive: created.isActive,
      createdAt: created.createdAt
    };
  }

  async grantUserBranchAccess(session: SessionUser, userId: string, branchId: string) {
    await this.settings.ensureBranchExists(branchId);
    if (session.branchId) {
      await this.branches.ensureUserHasBranchAccess(session.userId, session.branchId);
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.role !== UserRole.CASHIER) {
      throw new BadRequestException('Only cashier access updates are allowed');
    }

    await this.prisma.userBranchAccess.upsert({
      where: { userId_branchId: { userId, branchId } },
      update: {},
      create: { userId, branchId }
    });
  }

  async revokeUserBranchAccess(session: SessionUser, userId: string, branchId: string) {
    if (session.branchId) {
      await this.branches.ensureUserHasBranchAccess(session.userId, session.branchId);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, branchId: true }
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.role !== UserRole.CASHIER) {
      throw new BadRequestException('Only cashier access updates are allowed');
    }
    if (user.branchId === branchId) {
      throw new BadRequestException('Cannot remove the user primary branch access');
    }

    await this.prisma.userBranchAccess.delete({
      where: { userId_branchId: { userId, branchId } }
    });
  }

  async updateUser(
    session: SessionUser,
    userId: string,
    input: { username?: string; password?: string; isActive?: boolean; role?: UserRole }
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { branchAccesses: { select: { branchId: true } } }
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (session.branchId && !user.branchAccesses.some((access) => access.branchId === session.branchId)) {
      throw new BadRequestException('Branch mismatch');
    }
    if (input.role && input.role !== UserRole.CASHIER) {
      throw new BadRequestException('Only cashier role updates are allowed');
    }
    if (input.isActive === false && user.id === session.userId) {
      throw new BadRequestException('Cannot deactivate your own account');
    }
    if (input.password !== undefined) {
      const passwordError = validateNewPassword(input.password);
      if (passwordError) {
        throw new BadRequestException(passwordError);
      }
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        username: input.username,
        password: input.password !== undefined ? await hashPassword(input.password) : undefined,
        isActive: input.isActive
      },
      select: {
        id: true,
        username: true,
        role: true,
        branchId: true,
        isActive: true,
        createdAt: true,
        branchAccesses: { select: { branchId: true } }
      }
    });
    return {
      id: updated.id,
      username: updated.username,
      role: updated.role,
      branchId: updated.branchId,
      branchIds: updated.branchAccesses.map((access) => access.branchId),
      isActive: updated.isActive,
      createdAt: updated.createdAt
    };
  }
}
