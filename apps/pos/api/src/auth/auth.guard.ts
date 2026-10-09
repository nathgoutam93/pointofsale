import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { PASSWORD_CHANGE_REQUIRED } from '@pos/contracts';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma.service';
import { readBearerToken, signedBeforePasswordChange, verifyToken } from './token';
import { isOffline } from '../common/mode';
import { TenancyService } from '../tenancy/tenancy.service';

const IS_PUBLIC_KEY = 'isPublic';

/** Marks a route that can be called without a token (e.g. login). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

const ALLOW_PASSWORD_CHANGE_KEY = 'allowPasswordChange';

/** A route a user who must choose a new password can still use (changing it, who am I). */
export const AllowBeforePasswordChange = () => SetMetadata(ALLOW_PASSWORD_CHANGE_KEY, true);


/**
 * Runs before every route. The token signature only proves what was true when
 * it was issued, so the user, role, branch access and register are re-checked
 * against the database on each request.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService
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
    if (!isOffline()) {
      // Hosted server: everything after this runs against the token's business only.
      if (!session.businessId) {
        throw new UnauthorizedException('Session is no longer valid, please sign in again');
      }
      await this.tenancy.enterById(session.businessId);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
      select: { isActive: true, role: true, mustChangePassword: true, passwordChangedAt: true }
    });
    if (!user || !user.isActive || user.role !== session.role) {
      throw new UnauthorizedException('Session is no longer valid, please sign in again');
    }
    if (signedBeforePasswordChange(session.issuedAt, user.passwordChangedAt)) {
      throw new UnauthorizedException('Your password was changed, please sign in again');
    }
    if (
      user.mustChangePassword &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_PASSWORD_CHANGE_KEY, [context.getHandler(), context.getClass()])
    ) {
      throw new ForbiddenException({ statusCode: 403, code: PASSWORD_CHANGE_REQUIRED, message: 'Choose a new password first' });
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
