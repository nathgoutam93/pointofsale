import { Body, Controller, Get, Headers, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { appContract } from '@pos/contracts';
import { AccessService, COST_PERMISSIONS } from '../common/access.service';
import { getSession, RequestHeaders } from '../common/request-session';
import { type Parsed, ZodValidationPipe } from '../validation/zod-validation.pipe';
import { PurchaseReturnsService } from './purchase-returns.service';
import { PurchasesService } from './purchases.service';

@Controller()
export class PurchasesController {
  constructor(
    private readonly purchases: PurchasesService,
    private readonly returns: PurchaseReturnsService,
    private readonly access: AccessService
  ) {}

  @Post('/purchases')
  async createPurchase(
    @Body(new ZodValidationPipe(appContract.purchases.create.body)) body: Parsed<typeof appContract.purchases.create.body>,
    @Headers() headers: RequestHeaders
  ) {
    const session = getSession(headers);
    await this.access.requireBranch(session, body.branchId);
    await this.access.requirePermission(session, 'RECORD_PURCHASES');
    return this.purchases.createPurchase(session, body);
  }

  @Get('/purchases')
  async listPurchases(
    @Query(new ZodValidationPipe(appContract.purchases.list.query)) { branchId, supplierId }: Parsed<typeof appContract.purchases.list.query>,
    @Headers() headers: RequestHeaders
  ) {
    const session = getSession(headers);
    await this.access.requireAnyPermission(session, COST_PERMISSIONS);
    return this.purchases.listPurchases(session, branchId, supplierId);
  }

  @Get('/purchases/:id')
  async getPurchase(@Param('id', new ParseUUIDPipe()) id: string, @Headers() headers: RequestHeaders) {
    const session = await this.requirePurchaseBranch(id, headers);
    await this.access.requireAnyPermission(session, COST_PERMISSIONS);
    return this.purchases.getPurchase(id);
  }

  @Post('/purchases/:id/returns')
  async createReturn(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(appContract.purchases.createReturn.body)) body: Parsed<typeof appContract.purchases.createReturn.body>,
    @Headers() headers: RequestHeaders
  ) {
    const session = await this.requirePurchaseBranch(id, headers);
    await this.access.requirePermission(session, 'RECORD_PURCHASES');
    return this.returns.createReturn(session, id, body);
  }

  @Get('/purchase-returns')
  async listReturns(
    @Query(new ZodValidationPipe(appContract.purchases.listReturns.query)) { branchId, ...page }: Parsed<typeof appContract.purchases.listReturns.query>,
    @Headers() headers: RequestHeaders
  ) {
    const session = getSession(headers);
    await this.access.requireBranch(session, branchId);
    await this.access.requireAnyPermission(session, COST_PERMISSIONS);
    return this.returns.listReturns(branchId, page);
  }

  /** The session, once it may manage the branch the purchase was received at. */
  private async requirePurchaseBranch(purchaseId: string, headers: RequestHeaders) {
    const session = getSession(headers);
    const branchId = await this.returns.branchOfPurchase(purchaseId);
    if (!branchId) throw new NotFoundException('Purchase not found');
    await this.access.requireBranch(session, branchId);
    return session;
  }
}
