import { BadRequestException, Body, Controller, Get, HttpCode, Headers, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { appContract } from '@pos/contracts';
import { requireOpenRegisterSession, requireAdmin, RequestHeaders } from '../common/request-session';
import { ZodValidationPipe } from '../validation/zod-validation.pipe';
import { CustomersService } from './customers.service';

@Controller()
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get('/customers')
  listCustomers(
    @Query(new ZodValidationPipe(appContract.customers.list.query)) { branchId }: { branchId: string },
    @Headers() headers: RequestHeaders
  ) {
    const session = requireOpenRegisterSession(headers);
    if (session.branchId !== branchId) {
      throw new BadRequestException('Branch mismatch');
    }
    return this.customers.listCustomers(branchId);
  }

  @Post('/customers')
  createCustomer(
    @Body(new ZodValidationPipe(appContract.customers.create.body)) body: { branchId: string; name: string; phone?: string },
    @Headers() headers: RequestHeaders
  ) {
    const session = requireOpenRegisterSession(headers);
    if (session.branchId !== body.branchId) {
      throw new BadRequestException('Branch mismatch');
    }
    return this.customers.createCustomer(body.branchId, body.name, body.phone);
  }

  @Patch('/customers/:id')
  updateCustomer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(appContract.customers.update.body)) body: { name?: string; phone?: string | null },
    @Headers() headers: RequestHeaders
  ) {
    const session = requireOpenRegisterSession(headers);
    if (!session.branchId) {
      throw new BadRequestException('Branch mismatch');
    }
    return this.customers.updateCustomer(session.branchId, id, body);
  }

  @Get('/customers/walk-in/:branchId')
  getWalkIn(@Param('branchId', ParseUUIDPipe) branchId: string, @Headers() headers: RequestHeaders) {
    const session = requireOpenRegisterSession(headers);
    if (session.branchId !== branchId) {
      throw new BadRequestException('Branch mismatch');
    }
    return this.customers.getWalkIn(branchId);
  }

  @Get('/customers/:id/wallet')
  getWallet(@Param('id', ParseUUIDPipe) customerId: string, @Headers() headers: RequestHeaders) {
    const session = requireOpenRegisterSession(headers);
    return this.customers.getWallet(session.branchId!, customerId);
  }

  @Post('/customers/:id/wallet/topup')
  @HttpCode(200)
  topupWallet(
    @Param('id', ParseUUIDPipe) customerId: string,
    @Body(new ZodValidationPipe(appContract.customers.topupWallet.body)) body: { amount: number; reference?: string },
    @Headers() headers: RequestHeaders
  ) {
    const session = requireOpenRegisterSession(headers);
    requireAdmin(session);
    return this.customers.topupWallet(session.branchId!, customerId, body.amount, body.reference);
  }
}
