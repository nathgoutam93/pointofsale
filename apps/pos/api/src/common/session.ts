import { BadRequestException } from '@nestjs/common';
import type { SessionUser } from './types';

export function requireSessionBranchId(session: SessionUser) {
  if (!session.branchId) {
    throw new BadRequestException('Branch not selected. Open a register first.');
  }
  return session.branchId;
}

export function requireSessionRegisterId(session: SessionUser) {
  if (!session.registerId) {
    throw new BadRequestException('Register is not open.');
  }
  return session.registerId;
}
