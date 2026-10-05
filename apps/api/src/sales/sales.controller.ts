import { Body, Controller, Get, HttpCode, Headers, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { OnlineOnlyGuard } from '../common/mode';
import { FailureLimiter } from '../common/rate-limit';
import { ReceiptEmailService } from './receipt-email.service';
import { appContract } from '@pos/contracts';
import { UserRole } from '@prisma/client';
import { AccessService } from '../common/access.service';
import { getSession, requireOpenRegisterSession, RequestHeaders } from '../common/request-session';
import type { SessionUser } from '../common/types';
import { type Parsed, ZodValidationPipe } from '../validation/zod-validation.pipe';
import { SalesService } from './sales.service';

const receiptEmailsSent = new FailureLimiter(30, 60 * 60 * 1000);

@Controller()
export class SalesController {
  constructor(
    private readonly sales: SalesService,
    private readonly receiptEmails: ReceiptEmailService,
    private readonly access: AccessService
  ) {}

  /**
   * The branch to look a bill up at: for admins, the bill's own (if they manage it); for
   * cashiers, their register's, so another branch's bills stay out of sight.
   */
  private async lookupBranch(session: SessionUser, key: { invoice?: string; receipt?: string }) {
    const branchId = session.role === UserRole.ADMIN ? ((await this.sales.branchOf(key)) ?? session.branchId) : session.branchId;
    return this.access.requireBranch(session, branchId ?? '');
  }

  @Post('/sales')
  createSale(
    @Body(new ZodValidationPipe(appContract.sales.create.body))
    body: Parsed<typeof appContract.sales.create.body>,
    @Headers() headers: RequestHeaders
  ) {
    return this.sales.createSale(requireOpenRegisterSession(headers), body);
  }

  @Post('/sales/checkout')
  @HttpCode(200)
  checkoutSale(
    @Body(new ZodValidationPipe(appContract.sales.checkout.body))
    body: Parsed<typeof appContract.sales.checkout.body>,
    @Headers() headers: RequestHeaders
  ) {
    return this.sales.checkoutSale(requireOpenRegisterSession(headers), body);
  }

  @Post('/sales/:id/cancel')
  @HttpCode(200)
  async cancelSale(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(appContract.sales.cancel.body)) body: Parsed<typeof appContract.sales.cancel.body>,
    @Headers() headers: RequestHeaders
  ) {
    const session = getSession(headers);
    const branchId = await this.lookupBranch(session, { invoice: id });
    await this.access.requirePermission(session, 'CANCEL_SALES');
    return this.sales.cancelSale(session, branchId, id, body.reason);
  }

  @Post('/sales/:id/settle')
  @HttpCode(200)
  settleSale(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(appContract.sales.settle.body)) body: Parsed<typeof appContract.sales.settle.body>,
    @Headers() headers: RequestHeaders
  ) {
    return this.sales.settleSale(requireOpenRegisterSession(headers), id, body.payments);
  }

  @Get('/sales')
  async listSales(
    @Query(new ZodValidationPipe(appContract.sales.list.query))
    query: Parsed<typeof appContract.sales.list.query>,
    @Headers() headers: RequestHeaders
  ) {
    return this.sales.listSales(await this.access.requireBranch(getSession(headers), query.branchId), query);
  }

  @Get('/sales/:id')
  async getSaleById(@Param('id', ParseUUIDPipe) id: string, @Headers() headers: RequestHeaders) {
    return this.sales.getSaleById(await this.lookupBranch(getSession(headers), { invoice: id }), id);
  }

  /** Online: the receipt by email. 30 an hour per user, so a till can't be used to send mail in bulk. */
  @UseGuards(OnlineOnlyGuard)
  @Post('/sales/:id/email-receipt')
  @HttpCode(202)
  async emailReceipt(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(appContract.sales.emailReceipt.body)) body: Parsed<typeof appContract.sales.emailReceipt.body>,
    @Headers() headers: RequestHeaders
  ) {
    const session = getSession(headers);
    const branchId = await this.lookupBranch(session, { invoice: id });
    receiptEmailsSent.assertAllowed(session.userId);
    await this.receiptEmails.send(branchId, id, body.email);
    receiptEmailsSent.failed(session.userId);
    return { sent: true as const };
  }

  @Get('/receipts/:id')
  async getReceipt(@Param('id', ParseUUIDPipe) id: string, @Headers() headers: RequestHeaders) {
    return this.sales.getReceiptById(await this.lookupBranch(getSession(headers), { receipt: id }), id);
  }

  @Get('/receipts/by-invoice/:invoiceId')
  async getReceiptsByInvoice(@Param('invoiceId') invoiceId: string, @Headers() headers: RequestHeaders) {
    return this.sales.getReceiptsByInvoice(await this.lookupBranch(getSession(headers), { invoice: invoiceId }), invoiceId);
  }
}
