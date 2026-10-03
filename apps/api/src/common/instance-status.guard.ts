import { CanActivate, ExecutionContext, HttpException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { billingStateAt, PAYMENT_REQUIRED } from '@pos/contracts';
import { billingEnforced } from '../billing/gateways';
import { PrismaService } from '../prisma.service';
import { currentBusiness } from '../tenancy/tenant-context';
import { isOffline } from './mode';

const ALLOW_WHEN_LOCKED_KEY = 'allowWhenLocked';

/** A write route that still works while an offline business is moving online or has moved (e.g. sign-in). */
export const AllowWhenLocked = () => SetMetadata(ALLOW_WHEN_LOCKED_KEY, true);

const ALLOW_WHEN_UNPAID_KEY = 'allowWhenUnpaid';

/**
 * A write route that still works for a business whose subscription has ended (paying, closing a
 * register). Routes marked AllowWhenLocked (sign-in, passwords) work then too.
 */
export const AllowWhenUnpaid = () => SetMetadata(ALLOW_WHEN_UNPAID_KEY, true);

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** HTTP 402 Payment Required. */
const PAYMENT_REQUIRED_STATUS = 402;

/** HTTP 423 Locked (not in this Nest version's HttpStatus). */
const LOCKED = 423;

/**
 * Offline installs: while the business is being moved online (MIGRATING) or after it has moved
 * (ARCHIVED), every change is refused with 423 so no sale is made on a copy that will never
 * reach the online business. Reports, history and GST exports stay readable.
 *
 * Managed hosting: once a business's trial or paid time and the grace period after it are over,
 * changes are refused with 402 until it pays; reading, signing in and paying still work. The
 * business is the one the sign-in check entered, so public routes (a fallback counter's sync
 * of sales already made) are never stopped.
 */
@Injectable()
export class InstanceStatusGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{ method: string }>();
    if (READ_METHODS.has(request.method.toUpperCase())) return true;
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_WHEN_LOCKED_KEY, [context.getHandler(), context.getClass()])) {
      return true;
    }
    if (!isOffline()) {
      this.assertSubscriptionAllowsChanges(context);
      return true;
    }

    const instance = await this.prisma.localInstance.findUnique({ where: { id: 'local' }, select: { status: true } });
    if (instance?.status === 'MIGRATING') {
      throw new HttpException('This business is being moved online. Changes are paused until that finishes.', LOCKED);
    }
    if (instance?.status === 'ARCHIVED') {
      throw new HttpException(
        'This business has moved online. This copy is read-only; sign in to the online business to keep working.',
        LOCKED
      );
    }
    return true;
  }

  private assertSubscriptionAllowsChanges(context: ExecutionContext) {
    if (!billingEnforced()) return;
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_WHEN_UNPAID_KEY, [context.getHandler(), context.getClass()])) return;
    const billing = currentBusiness()?.billing;
    if (!billing || billingStateAt(billing).state !== 'read_only') return;
    throw new HttpException(
      {
        statusCode: PAYMENT_REQUIRED_STATUS,
        code: PAYMENT_REQUIRED,
        message: 'The subscription has ended, so this business is read-only. An admin can pay under Settings → Billing.'
      },
      PAYMENT_REQUIRED_STATUS
    );
  }
}
