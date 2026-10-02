import { BadRequestException, Body, Controller, Get, Headers, Patch, Post, Query } from '@nestjs/common';
import { appContract } from '@pos/contracts';
import { requireOpenRegisterSession, requireAdmin, RequestHeaders } from '../common/request-session';
import { ZodValidationPipe } from '../validation/zod-validation.pipe';
import { StockService } from './stock.service';

@Controller()
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Post('/stock/opening')
  stockOpening(
    @Body(new ZodValidationPipe(appContract.stock.opening.body)) body: { branchId: string; itemId: string; qty: number; costPrice?: number; reason?: string },
    @Headers() headers: RequestHeaders
  ) {
    const session = requireOpenRegisterSession(headers);
    requireAdmin(session);
    if (session.branchId !== body.branchId) {
      throw new BadRequestException('Branch mismatch');
    }
    return this.stock.createStockOpening(body.branchId, body.itemId, body.qty, body.costPrice, body.reason);
  }

  @Patch('/stock/opening')
  updateStockOpening(
    @Body(new ZodValidationPipe(appContract.stock.updateOpening.body)) body: { branchId: string; itemId: string; qty: number; costPrice?: number; reason?: string },
    @Headers() headers: RequestHeaders
  ) {
    const session = requireOpenRegisterSession(headers);
    requireAdmin(session);
    if (session.branchId !== body.branchId) {
      throw new BadRequestException('Branch mismatch');
    }
    return this.stock.updateStockOpening(body.branchId, body.itemId, body.qty, body.costPrice, body.reason);
  }

  @Post('/stock/adjustment')
  stockAdjustment(
    @Body(new ZodValidationPipe(appContract.stock.adjustment.body)) body: { branchId: string; itemId: string; qty: number; direction: 'IN' | 'OUT'; costPrice?: number; reason: string },
    @Headers() headers: RequestHeaders
  ) {
    const session = requireOpenRegisterSession(headers);
    requireAdmin(session);
    if (session.branchId !== body.branchId) {
      throw new BadRequestException('Branch mismatch');
    }
    return this.stock.createStockAdjustment(body.branchId, body.itemId, body.qty, body.direction, body.costPrice, body.reason);
  }

  @Get('/stock/on-hand')
  onHand(
    @Query(new ZodValidationPipe(appContract.stock.onHand.query)) { branchId, itemId }: { branchId: string; itemId?: string },
    @Headers() headers: RequestHeaders
  ) {
    const session = requireOpenRegisterSession(headers);
    if (session.branchId !== branchId) {
      throw new BadRequestException('Branch mismatch');
    }
    return this.stock.getOnHand(branchId, itemId);
  }

  @Get('/stock/ledger')
  stockLedger(
    @Query(new ZodValidationPipe(appContract.stock.ledger.query)) { branchId, itemId }: { branchId: string; itemId?: string },
    @Headers() headers: RequestHeaders
  ) {
    const session = requireOpenRegisterSession(headers);
    if (session.branchId !== branchId) {
      throw new BadRequestException('Branch mismatch');
    }
    return this.stock.getLedger(branchId, itemId);
  }
}
