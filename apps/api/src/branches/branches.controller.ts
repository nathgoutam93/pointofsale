import { Body, Controller, Get, Headers, Post } from '@nestjs/common';
import { appContract } from '@pos/contracts';
import { getSession, requireAdminSession, RequestHeaders } from '../common/request-session';
import { ZodValidationPipe } from '../validation/zod-validation.pipe';
import { BranchesService } from './branches.service';

@Controller()
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get('/branches')
  listAccessibleBranches(@Headers() headers: RequestHeaders) {
    return this.branches.listAccessibleBranches(getSession(headers));
  }

  @Post('/branches')
  createBranch(
    @Body(new ZodValidationPipe(appContract.branches.create.body)) body: { name: string; code: string },
    @Headers() headers: RequestHeaders
  ) {
    const session = requireAdminSession(headers);
    return this.branches.createBranch(session, body);
  }
}
