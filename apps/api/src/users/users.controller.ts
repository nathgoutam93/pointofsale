import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Headers, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { appContract } from '@pos/contracts';
import { requireAdminSession, RequestHeaders } from '../common/request-session';
import { ZodValidationPipe } from '../validation/zod-validation.pipe';
import { UsersService } from './users.service';

@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('/users')
  listUsers(
    @Query(new ZodValidationPipe(appContract.users.list.query)) { branchId }: { branchId: string },
    @Headers() headers: RequestHeaders
  ) {
    const session = requireAdminSession(headers);
    if (session.branchId && session.branchId !== branchId) {
      throw new BadRequestException('Branch mismatch');
    }
    return this.users.listUsers(branchId);
  }

  @Post('/users')
  createUser(
    @Body(new ZodValidationPipe(appContract.users.create.body)) body: { branchId: string; username: string; password: string; branchIds?: string[] },
    @Headers() headers: RequestHeaders
  ) {
    const session = requireAdminSession(headers);
    if (session.branchId && session.branchId !== body.branchId) {
      throw new BadRequestException('Branch mismatch');
    }
    return this.users.createUser(body.branchId, body);
  }

  @Patch('/users/:id')
  updateUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(appContract.users.update.body)) body: { username?: string; password?: string; mustChangePassword?: boolean; isActive?: boolean },
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
