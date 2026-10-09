import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { CashierPermission, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { hashPassword, newPasswordFields, validateNewPassword } from '../auth/password';
import type { SessionUser } from '../common/types';
import { SettingsService } from '../settings/settings.service';
import { BranchesService } from '../branches/branches.service';

const userSelect = {
  id: true,
  username: true,
  role: true,
  branchId: true,
  isActive: true,
  mustChangePassword: true,
  permissions: true,
  createdAt: true,
  branchAccesses: { select: { branchId: true } }
} satisfies Prisma.UserSelect;

function toUser(user: Prisma.UserGetPayload<{ select: typeof userSelect }>) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    branchId: user.branchId,
    branchIds: user.branchAccesses.map((access) => access.branchId),
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    // Admins can do everything; permissions only mean something for cashiers.
    permissions: user.role === UserRole.CASHIER ? user.permissions : [],
    createdAt: user.createdAt
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly branches: BranchesService,
    private readonly audit: AuditService
  ) {}

  async listUsers(branchId: string) {
    await this.settings.ensureBranchExists(branchId);
    const users = await this.prisma.user.findMany({
      where: { branchAccesses: { some: { branchId } } },
      orderBy: { createdAt: 'desc' },
      select: userSelect
    });
    return users.map(toUser);
  }

  async createUser(
    session: SessionUser,
    branchId: string,
    input: { username: string; password: string; role?: UserRole; branchIds?: string[]; permissions?: CashierPermission[] }
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
        permissions: input.permissions ?? [],
        branchAccesses: {
          createMany: {
            data: uniqueBranchIds.map((id) => ({ branchId: id }))
          }
        }
      },
      select: userSelect
    });
    await this.audit.record(session, {
      action: 'USER_CREATED',
      entityType: 'User',
      entityId: created.id,
      branchId,
      summary: `Added cashier ${created.username}${(input.permissions ?? []).length ? ` allowed to: ${(input.permissions ?? []).join(', ')}` : ''}`,
      details: { permissions: input.permissions ?? [], branchIds: uniqueBranchIds }
    });
    return toUser(created);
  }

  async grantUserBranchAccess(session: SessionUser, userId: string, branchId: string) {
    await this.settings.ensureBranchExists(branchId);
    await this.branches.ensureUserHasBranchAccess(session.userId, branchId);

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
    await this.audit.record(session, { action: 'BRANCH_ACCESS_GRANTED', entityType: 'User', entityId: userId, branchId, summary: 'Gave a cashier access to this branch' });
  }

  async revokeUserBranchAccess(session: SessionUser, userId: string, branchId: string) {
    await this.branches.ensureUserHasBranchAccess(session.userId, branchId);

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
    await this.audit.record(session, { action: 'BRANCH_ACCESS_REVOKED', entityType: 'User', entityId: userId, branchId, summary: "Took away a cashier's access to this branch" });
  }

  async updateUser(
    session: SessionUser,
    userId: string,
    input: { username?: string; password?: string; mustChangePassword?: boolean; isActive?: boolean; role?: UserRole; permissions?: CashierPermission[] }
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { branchAccesses: { select: { branchId: true } } }
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    // An admin manages the people of the branches they have access to.
    await this.branches.ensureUserHasBranchAccess(session.userId, user.branchId);
    if (input.permissions !== undefined && user.role !== UserRole.CASHIER) {
      throw new BadRequestException('Admins can already do everything; permissions are for cashiers');
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
        // Someone else's password, set by an admin: they choose their own at next sign-in.
        ...(input.password !== undefined
          ? newPasswordFields(await hashPassword(input.password), input.mustChangePassword ?? user.id !== session.userId)
          : {}),
        isActive: input.isActive,
        permissions: input.permissions
      },
      select: userSelect
    });
    const changes = AuditService.changes(user, updated, ['username', 'isActive', 'permissions']);
    if (input.password !== undefined) changes.password = ['(hidden)', user.id === session.userId ? 'changed by themselves' : 'reset by an admin'];
    if (Object.keys(changes).length > 0) {
      await this.audit.record(session, {
        action: changes.permissions ? 'USER_PERMISSIONS_CHANGED' : 'USER_UPDATED',
        entityType: 'User',
        entityId: userId,
        branchId: user.branchId,
        summary: `Changed ${updated.username}: ${Object.keys(changes).join(', ')}`,
        details: { changes } as Prisma.InputJsonValue
      });
    }
    return toUser(updated);
  }
}
