import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CASHIER_PERMISSION_LABELS, type CashierPermission } from '@pos/contracts';
import { BranchesService } from '../branches/branches.service';
import { PrismaService } from '../prisma.service';
import type { SessionUser } from './types';

/** The permissions that come with seeing what goods cost. */
export const COST_PERMISSIONS: CashierPermission[] = ['MANAGE_STOCK', 'RECORD_PURCHASES'];

/**
 * Who may do what, where:
 * - Selling (checkout, returns, taking payments) happens at the branch of the open register.
 * - Managing a branch (its stock, customers, sales history, settings): admins may manage any
 *   branch they have access to, with or without a register open; cashiers only the branch of
 *   their open register.
 * - Beyond selling, cashiers may only do what an admin allowed them (CashierPermission).
 */
@Injectable()
export class AccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branches: BranchesService
  ) {}

  /** The branch a request manages, once the user may manage it. */
  async requireBranch(session: SessionUser, branchId: string) {
    if (session.role === UserRole.ADMIN) {
      await this.branches.ensureUserHasBranchAccess(session.userId, branchId);
      return branchId;
    }
    if (!session.branchId) {
      throw new BadRequestException('Select a branch and open a register first');
    }
    if (session.branchId !== branchId) {
      throw new ForbiddenException('Branch mismatch');
    }
    return branchId;
  }

  /**
   * Whether a user may see what goods cost (cost prices, purchase prices and purchase history):
   * admins, and cashiers who adjust stock or record purchases. Others never get them (see
   * CostVisibilityInterceptor).
   */
  async maySeeCosts(session: SessionUser) {
    if (session.role === UserRole.ADMIN) return true;
    const user = await this.prisma.user.findUnique({ where: { id: session.userId }, select: { permissions: true } });
    return COST_PERMISSIONS.some((permission) => user?.permissions.includes(permission) ?? false);
  }

  /** Admins always; cashiers when an admin gave them any of `permissions`. */
  async requireAnyPermission(session: SessionUser, permissions: CashierPermission[]) {
    if (session.role === UserRole.ADMIN) return;
    const user = await this.prisma.user.findUnique({ where: { id: session.userId }, select: { permissions: true } });
    if (!permissions.some((permission) => user?.permissions.includes(permission))) {
      const labels = permissions.map((permission) => CASHIER_PERMISSION_LABELS[permission].label.toLowerCase());
      throw new ForbiddenException(`You aren't allowed to ${labels.join(' or ')}. Ask an admin.`);
    }
  }

  /** Admins always; cashiers when an admin gave them `permission`. */
  async requirePermission(session: SessionUser, permission: CashierPermission) {
    if (session.role === UserRole.ADMIN) return;
    const user = await this.prisma.user.findUnique({ where: { id: session.userId }, select: { permissions: true } });
    if (!user?.permissions.includes(permission)) {
      throw new ForbiddenException(`You aren't allowed to ${CASHIER_PERMISSION_LABELS[permission].label.toLowerCase()}. Ask an admin.`);
    }
  }
}
