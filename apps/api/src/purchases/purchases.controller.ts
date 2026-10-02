import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { appContract } from '@pos/contracts';
import { getSession, requireAdminSession, RequestHeaders } from '../common/request-session';
import { ZodValidationPipe } from '../validation/zod-validation.pipe';
import { PurchasesService, type CreatePurchaseInput } from './purchases.service';

@Controller()
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Post('/purchases')
  createPurchase(
    @Body(new ZodValidationPipe(appContract.purchases.create.body)) body: CreatePurchaseInput,
    @Headers() headers: RequestHeaders
  ) {
    return this.purchases.createPurchase(requireAdminSession(headers), body);
  }

  @Get('/purchases')
  listPurchases(
    @Query(new ZodValidationPipe(appContract.purchases.list.query)) { branchId }: { branchId: string },
    @Headers() headers: RequestHeaders
  ) {
    return this.purchases.listPurchases(getSession(headers), branchId);
  }
}
