import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { appContract } from '@pos/contracts';
import { AccessService } from '../common/access.service';
import { getSession, RequestHeaders } from '../common/request-session';
import { ZodValidationPipe } from '../validation/zod-validation.pipe';
import { PurchasesService, type CreatePurchaseInput } from './purchases.service';

@Controller()
export class PurchasesController {
  constructor(
    private readonly purchases: PurchasesService,
    private readonly access: AccessService
  ) {}

  @Post('/purchases')
  async createPurchase(
    @Body(new ZodValidationPipe(appContract.purchases.create.body)) body: CreatePurchaseInput,
    @Headers() headers: RequestHeaders
  ) {
    const session = getSession(headers);
    await this.access.requireBranch(session, body.branchId);
    await this.access.requirePermission(session, 'RECORD_PURCHASES');
    return this.purchases.createPurchase(session, body);
  }

  @Get('/purchases')
  listPurchases(
    @Query(new ZodValidationPipe(appContract.purchases.list.query)) { branchId }: { branchId: string },
    @Headers() headers: RequestHeaders
  ) {
    return this.purchases.listPurchases(getSession(headers), branchId);
  }
}
