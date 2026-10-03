import { Body, Controller, Get, HttpCode, Headers, Post } from '@nestjs/common';
import { appContract, DEVICE_HEADER } from '@pos/contracts';
import { AllowWhenUnpaid } from '../common/instance-status.guard';
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
    const device = headers[DEVICE_HEADER];
    return this.registers.openRegister(getSession(headers), body.branchId, body.openingBalance, body.counterId, typeof device === 'string' ? device : undefined);
  }

  @Get('/registers/current')
  currentRegister(@Headers() headers: RequestHeaders) {
    return this.registers.getCurrentRegister(getSession(headers));
  }

  @Get('/registers/summary')
  registerSummary(@Headers() headers: RequestHeaders) {
    return this.registers.getRegisterSummaries(getSession(headers));
  }

  /** Still allowed once a subscription has ended: the day's cash is counted either way. */
  @Post('/registers/close')
  @AllowWhenUnpaid()
  @HttpCode(200)
  closeRegister(
    @Body(new ZodValidationPipe(appContract.registers.close.body)) body: { closingBalance: number },
    @Headers() headers: RequestHeaders
  ) {
    return this.registers.closeRegister(requireOpenRegisterSession(headers), body.closingBalance);
  }
}
