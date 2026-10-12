import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { readBearerToken, verifyToken } from '../auth/token';
import type { SessionUser } from './types';

/** A request's headers, as controllers receive them. */
export type RequestHeaders = Record<string, string | string[] | undefined>;

/** The signed-in session. AuthGuard has already verified the token and re-checked it against the database. */
export function getSession(headers: RequestHeaders): SessionUser {
  const token = readBearerToken(headers);
  const session = token ? verifyToken(token) : null;
  if (!session) {
    throw new UnauthorizedException('Invalid bearer token');
  }
  return session;
}

export function requireBranchSession(headers: RequestHeaders) {
  const session = getSession(headers);
  if (!session.branchId) {
    throw new BadRequestException('Select a branch and open a register first');
  }
  return session;
}

export function requireOpenRegisterSession(headers: RequestHeaders) {
  const session = requireBranchSession(headers);
  if (!session.registerId) {
    throw new BadRequestException('Register is not open');
  }
  return session;
}

export function requireAdminSession(headers: RequestHeaders) {
  const session = getSession(headers);
  requireAdmin(session);
  return session;
}

export function requireAdmin(session: SessionUser) {
  if (session.role !== UserRole.ADMIN) {
    throw new ForbiddenException('Admin role required');
  }
}
