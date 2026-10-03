import { Body, Controller, Get, Headers, Patch, Post, Query } from '@nestjs/common';
import { appContract } from '@pos/contracts';
import { AccessService } from '../common/access.service';
import { getSession, RequestHeaders } from '../common/request-session';
import { ZodValidationPipe } from '../validation/zod-validation.pipe';
import { StockService } from './stock.service';

@Controller()
export class StockController {
  constructor(
    private readonly stock: StockService,
    private readonly access: AccessService
  ) {}

  /** Stock changes: at a branch the user manages, by an admin or a cashier allowed to. */
  private async changing(headers: RequestHeaders, branchId: string) {
    const session = getSession(headers);
    await this.access.requireBranch(session, branchId);
    await this.access.requirePermission(session, 'MANAGE_STOCK');
  }

  @Post('/stock/opening')
  async stockOpening(
    @Body(new ZodValidationPipe(appContract.stock.opening.body)) body: { branchId: string; itemId: string; qty: number; costPrice?: number; reason?: string },
    @Headers() headers: RequestHeaders
  ) {
    await this.changing(headers, body.branchId);
    return this.stock.createStockOpening(body.branchId, body.itemId, body.qty, body.costPrice, body.reason);
  }

  @Patch('/stock/opening')
  async updateStockOpening(
    @Body(new ZodValidationPipe(appContract.stock.updateOpening.body)) body: { branchId: string; itemId: string; qty: number; costPrice?: number; reason?: string },
    @Headers() headers: RequestHeaders
  ) {
    await this.changing(headers, body.branchId);
    return this.stock.updateStockOpening(body.branchId, body.itemId, body.qty, body.costPrice, body.reason);
  }

  @Post('/stock/adjustment')
  async stockAdjustment(
    @Body(new ZodValidationPipe(appContract.stock.adjustment.body)) body: { branchId: string; itemId: string; qty: number; direction: 'IN' | 'OUT'; costPrice?: number; reason: string },
    @Headers() headers: RequestHeaders
  ) {
    await this.changing(headers, body.branchId);
    return this.stock.createStockAdjustment(body.branchId, body.itemId, body.qty, body.direction, body.costPrice, body.reason);
  }

  @Get('/stock/on-hand')
  async onHand(
    @Query(new ZodValidationPipe(appContract.stock.onHand.query)) { branchId, itemId }: { branchId: string; itemId?: string },
    @Headers() headers: RequestHeaders
  ) {
    await this.access.requireBranch(getSession(headers), branchId);
    return this.stock.getOnHand(branchId, itemId);
  }

  @Get('/stock/ledger')
  async stockLedger(
    @Query(new ZodValidationPipe(appContract.stock.ledger.query)) { branchId, itemId }: { branchId: string; itemId?: string },
    @Headers() headers: RequestHeaders
  ) {
    await this.access.requireBranch(getSession(headers), branchId);
    return this.stock.getLedger(branchId, itemId);
  }
}
