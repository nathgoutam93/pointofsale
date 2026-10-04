import { Body, Controller, Delete, Get, HttpCode, Headers, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { appContract, type CashierPermission } from '@pos/contracts';
import { AccessService } from '../common/access.service';
import { requireAdminSession, RequestHeaders } from '../common/request-session';
import { ZodValidationPipe } from '../validation/zod-validation.pipe';
import { UsersService } from './users.service';

@Controller()
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly access: AccessService
  ) {}

  @Get('/users')
  async listUsers(
    @Query(new ZodValidationPipe(appContract.users.list.query)) { branchId }: { branchId: string },
    @Headers() headers: RequestHeaders
  ) {
    const session = requireAdminSession(headers);
    return this.users.listUsers(await this.access.requireBranch(session, branchId));
  }

  @Post('/users')
  async createUser(
    @Body(new ZodValidationPipe(appContract.users.create.body))
    body: { branchId: string; username: string; password: string; branchIds?: string[]; permissions?: CashierPermission[] },
    @Headers() headers: RequestHeaders
  ) {
    const session = requireAdminSession(headers);
    await this.access.requireBranch(session, body.branchId);
    for (const branchId of body.branchIds ?? []) await this.access.requireBranch(session, branchId);
    return this.users.createUser(session, body.branchId, body);
  }

  @Patch('/users/:id')
  updateUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(appContract.users.update.body)) body: { username?: string; password?: string; mustChangePassword?: boolean; isActive?: boolean; permissions?: CashierPermission[] },
    @Headers() headers: RequestHeaders
  ) {
    const session = requireAdminSession(headers);
    return this.users.updateUser(session, id, body);
  }

  @Post('/users/:id/branches/:branchId')
  @HttpCode(204)
  addUserBranchAccess(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Headers() headers: RequestHeaders
  ) {
    const session = requireAdminSession(headers);
    return this.users.grantUserBranchAccess(session, id, branchId);
  }

  @Delete('/users/:id/branches/:branchId')
  @HttpCode(204)
  removeUserBranchAccess(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Headers() headers: RequestHeaders
  ) {
    const session = requireAdminSession(headers);
    return this.users.revokeUserBranchAccess(session, id, branchId);
  }
}
