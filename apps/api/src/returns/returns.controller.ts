import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { appContract } from '@pos/contracts';
import { AccessService } from '../common/access.service';
import { getSession, requireOpenRegisterSession, RequestHeaders } from '../common/request-session';
import { ZodValidationPipe } from '../validation/zod-validation.pipe';
import { ReturnsService } from './returns.service';

@Controller()
export class ReturnsController {
  constructor(
    private readonly returns: ReturnsService,
    private readonly access: AccessService
  ) {}

  @Post('/sales/:id/return')
  async createReturn(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(appContract.sales.returns.body))
    body: { lines: Array<{ saleLineId: string; qty: number }>; refundMode: 'CASH' | 'WALLET'; reason: string },
    @Headers() headers: RequestHeaders
  ) {
    const session = requireOpenRegisterSession(headers);
    await this.access.requirePermission(session, 'MAKE_RETURNS');
    return this.returns.createReturn(session, id, body);
  }

  @Get('/returns')
  async listReturns(
    @Query(new ZodValidationPipe(appContract.returns.list.query))
    query: { branchId?: string; search?: string; before?: string; beforeId?: string; limit: number },
    @Headers() headers: RequestHeaders
  ) {
    const session = getSession(headers);
    return this.returns.listReturns(await this.access.requireBranch(session, query.branchId ?? session.branchId ?? ''), query);
  }

  @Get('/returns/:id')
  async getReturnById(@Param('id', ParseUUIDPipe) id: string, @Headers() headers: RequestHeaders) {
    const session = getSession(headers);
    // Admins: the return's own branch, if they manage it. Cashiers: their register's.
    const branchId = session.role === UserRole.ADMIN ? ((await this.returns.branchOf(id)) ?? session.branchId) : session.branchId;
    return this.returns.getReturnById(await this.access.requireBranch(session, branchId ?? ''), id);
  }
}
