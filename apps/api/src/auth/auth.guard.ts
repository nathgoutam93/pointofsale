import { CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma.service';
import { readBearerToken, verifyToken } from './token';

const IS_PUBLIC_KEY = 'isPublic';

/** Marks a route that can be called without a token (e.g. login). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Runs before every route. The token signature only proves what was true when
 * it was issued, so the user, role, branch access and register are re-checked
 * against the database on each request.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService
  ) {}

  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined> }>();
    const token = readBearerToken(request.headers);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const session = verifyToken(token);
    if (!session) {
      throw new UnauthorizedException('Session expired, please sign in again');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
      select: { isActive: true, role: true }
    });
    if (!user || !user.isActive || user.role !== session.role) {
      throw new UnauthorizedException('Session is no longer valid, please sign in again');
    }

    if (session.branchId) {
      const access = await this.prisma.userBranchAccess.findUnique({
        where: { userId_branchId: { userId: session.userId, branchId: session.branchId } },
        select: { id: true }
      });
      if (!access) {
        throw new UnauthorizedException('Branch access was removed, please sign in again');
      }
    }

    if (session.registerId) {
      const register = await this.prisma.registerSession.findFirst({
        where: { id: session.registerId, userId: session.userId, branchId: session.branchId, closedAt: null },
        select: { id: true }
      });
      if (!register) {
        throw new UnauthorizedException('Register is closed, please sign in again');
      }
    }

    return true;
  }
}
