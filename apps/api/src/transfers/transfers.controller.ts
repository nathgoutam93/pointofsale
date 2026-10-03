import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { appContract } from '@pos/contracts';
import { getSession, RequestHeaders } from '../common/request-session';
import { ZodValidationPipe } from '../validation/zod-validation.pipe';
import { TransfersService, type CreateTransferInput } from './transfers.service';

@Controller()
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @Post('/stock-transfers')
  createTransfer(
    @Body(new ZodValidationPipe(appContract.transfers.create.body)) body: CreateTransferInput,
    @Headers() headers: RequestHeaders
  ) {
    return this.transfers.createTransfer(getSession(headers), body);
  }

  @Get('/stock-transfers')
  listTransfers(
    @Query(new ZodValidationPipe(appContract.transfers.list.query)) { branchId }: { branchId: string },
    @Headers() headers: RequestHeaders
  ) {
    return this.transfers.listTransfers(getSession(headers), branchId);
  }

  @Post('/stock-transfers/:id/receive')
  @HttpCode(200)
  receiveTransfer(@Param('id', ParseUUIDPipe) id: string, @Headers() headers: RequestHeaders) {
    return this.transfers.receiveTransfer(getSession(headers), id);
  }

  @Post('/stock-transfers/:id/cancel')
  @HttpCode(200)
  cancelTransfer(@Param('id', ParseUUIDPipe) id: string, @Headers() headers: RequestHeaders) {
    return this.transfers.cancelTransfer(getSession(headers), id);
  }
}
