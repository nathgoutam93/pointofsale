import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { appContract } from '@pos/contracts';
import { getSession, requireAdminSession, RequestHeaders } from '../common/request-session';
import { type Parsed, ZodValidationPipe } from '../validation/zod-validation.pipe';
import { CountersService } from './counters.service';

@Controller()
export class CountersController {
  constructor(private readonly counters: CountersService) {}

  @Get('/branches/:branchId/counters')
  listCounters(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query(new ZodValidationPipe(appContract.counters.list.query)) query: Parsed<typeof appContract.counters.list.query>,
    @Headers() headers: RequestHeaders
  ) {
    return this.counters.listCounters(getSession(headers), branchId, query.includeInactive === 'true');
  }

  @Post('/branches/:branchId/counters')
  createCounter(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body(new ZodValidationPipe(appContract.counters.create.body)) body: Parsed<typeof appContract.counters.create.body>,
    @Headers() headers: RequestHeaders
  ) {
    return this.counters.createCounter(requireAdminSession(headers), branchId, body.name);
  }

  @Patch('/counters/:id')
  updateCounter(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(appContract.counters.update.body)) body: Parsed<typeof appContract.counters.update.body>,
    @Headers() headers: RequestHeaders
  ) {
    return this.counters.updateCounter(requireAdminSession(headers), id, body);
  }
}
