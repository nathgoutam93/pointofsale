import { Body, Controller, Get, HttpCode, Headers, Post } from '@nestjs/common';
import { appContract } from '@pos/contracts';
import { getSession, requireOpenRegisterSession, RequestHeaders } from '../common/request-session';
import { ZodValidationPipe } from '../validation/zod-validation.pipe';
import { RegistersService } from './registers.service';

@Controller()
export class RegistersController {
  constructor(private readonly registers: RegistersService) {}

  @Post('/registers/open')
  @HttpCode(200)
  openRegister(
    @Body(new ZodValidationPipe(appContract.registers.open.body))
    body: { branchId: string; counterId?: string; openingBalance: number },
    @Headers() headers: RequestHeaders
  ) {
    return this.registers.openRegister(getSession(headers), body.branchId, body.openingBalance, body.counterId);
  }

  @Get('/registers/current')
  currentRegister(@Headers() headers: RequestHeaders) {
    return this.registers.getCurrentRegister(getSession(headers));
  }

  @Get('/registers/summary')
  registerSummary(@Headers() headers: RequestHeaders) {
    return this.registers.getRegisterSummaries(getSession(headers));
  }

  @Post('/registers/close')
  @HttpCode(200)
  closeRegister(
    @Body(new ZodValidationPipe(appContract.registers.close.body)) body: { closingBalance: number },
    @Headers() headers: RequestHeaders
  ) {
    return this.registers.closeRegister(requireOpenRegisterSession(headers), body.closingBalance);
  }
}
