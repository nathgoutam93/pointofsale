import { Controller, Get, Headers, Query } from '@nestjs/common';
import { appContract } from '@pos/contracts';
import { AuditService } from '../common/audit.service';
import { requireAdminSession, RequestHeaders } from '../common/request-session';
import { PrismaService } from '../prisma.service';
import { ZodValidationPipe } from '../validation/zod-validation.pipe';

@Controller()
export class AuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly prisma: PrismaService
  ) {}

  /** Admins: the log for the business and the branches they manage, newest first. */
  @Get('/audit')
  async list(
    @Query(new ZodValidationPipe(appContract.audit.list.query)) query: { action?: string; before?: string; limit: number },
    @Headers() headers: RequestHeaders
  ) {
    const session = requireAdminSession(headers);
    const accesses = await this.prisma.userBranchAccess.findMany({ where: { userId: session.userId }, select: { branchId: true } });
    return this.audit.list({
      branchIds: accesses.map((access) => access.branchId),
      action: query.action,
      before: query.before ? new Date(query.before) : undefined,
      limit: query.limit
    });
  }
}
