import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { appContract } from '@pos/contracts';
import { requireOpenRegisterSession, RequestHeaders } from '../common/request-session';
import { ZodValidationPipe } from '../validation/zod-validation.pipe';
import { ReturnsService } from './returns.service';

@Controller()
export class ReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Post('/sales/:id/return')
  createReturn(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(appContract.sales.returns.body)) body: { lines: Array<{ saleLineId: string; qty: number }>; refundMode: 'CASH' | 'WALLET' },
    @Headers() headers: RequestHeaders
  ) {
    return this.returns.createReturn(requireOpenRegisterSession(headers), id, body);
  }

  @Get('/returns')
  listReturns(@Headers() headers: RequestHeaders) {
    const session = requireOpenRegisterSession(headers);
    return this.returns.listReturns(session.branchId!);
  }

  @Get('/returns/:id')
  getReturnById(@Param('id', ParseUUIDPipe) id: string, @Headers() headers: RequestHeaders) {
    return this.returns.getReturnById(requireOpenRegisterSession(headers), id);
  }
}
