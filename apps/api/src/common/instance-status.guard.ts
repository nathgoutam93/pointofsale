import { CanActivate, ExecutionContext, HttpException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma.service';
import { isOffline } from './mode';

const ALLOW_WHEN_LOCKED_KEY = 'allowWhenLocked';

/** A write route that still works while an offline business is moving online or has moved (e.g. sign-in). */
export const AllowWhenLocked = () => SetMetadata(ALLOW_WHEN_LOCKED_KEY, true);

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** HTTP 423 Locked (not in this Nest version's HttpStatus). */
const LOCKED = 423;

/**
 * Offline installs only. While the business is being moved online (MIGRATING) or after it
 * has moved (ARCHIVED), every change is refused with 423 so no sale is made on a copy that
 * will never reach the online business. Reports, history and GST exports stay readable.
 */
@Injectable()
export class InstanceStatusGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService
  ) {}

  async canActivate(context: ExecutionContext) {
    if (!isOffline()) return true;
    const request = context.switchToHttp().getRequest<{ method: string }>();
    if (READ_METHODS.has(request.method.toUpperCase())) return true;
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_WHEN_LOCKED_KEY, [context.getHandler(), context.getClass()])) {
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
}
