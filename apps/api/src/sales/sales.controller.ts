import { BadRequestException, Body, Controller, Get, HttpCode, Headers, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { OnlineOnlyGuard } from '../common/mode';
import { FailureLimiter } from '../common/rate-limit';
import { ReceiptEmailService } from './receipt-email.service';
import { PaymentMode } from '@prisma/client';
import { appContract } from '@pos/contracts';
import { requireOpenRegisterSession, requireAdmin, RequestHeaders } from '../common/request-session';
import { ZodValidationPipe } from '../validation/zod-validation.pipe';
import { SalesService } from './sales.service';

const receiptEmailsSent = new FailureLimiter(30, 60 * 60 * 1000);

@Controller()
export class SalesController {
  constructor(
    private readonly sales: SalesService,
    private readonly receiptEmails: ReceiptEmailService
  ) {}

  @Post('/sales')
  createSale(
    @Body(new ZodValidationPipe(appContract.sales.create.body))
    body: {
      branchId: string;
      customerId: string;
      walkInCustomerName?: string | null;
      walkInCustomerPhone?: string | null;
      placeOfSupplyStateCode?: string;
      lines: Array<{
        itemId: string;
        qty: number;
        rate: number;
        saleUom?: string;
        saleUomQty?: number;
        saleUomConversionQty?: number;
        taxRate: number;
        taxMode?: 'INCLUSIVE' | 'EXCLUSIVE';
        discounts?: Array<{ type: 'PERCENTAGE' | 'FIXED'; value: number }>;
      }>;
      discounts?: Array<{ type: 'PERCENTAGE' | 'FIXED'; value: number }>;
    },
    @Headers() headers: RequestHeaders
  ) {
    return this.sales.createSale(requireOpenRegisterSession(headers), body);
  }

  @Post('/sales/checkout')
  @HttpCode(200)
  checkoutSale(
    @Body(new ZodValidationPipe(appContract.sales.checkout.body))
    body: {
      branchId: string;
      customerId: string;
      walkInCustomerName?: string | null;
      walkInCustomerPhone?: string | null;
      placeOfSupplyStateCode?: string;
      lines: Array<{
        itemId: string;
        qty: number;
        rate: number;
        saleUom?: string;
        saleUomQty?: number;
        saleUomConversionQty?: number;
        taxRate: number;
        taxMode?: 'INCLUSIVE' | 'EXCLUSIVE';
        discounts?: Array<{ type: 'PERCENTAGE' | 'FIXED'; value: number }>;
      }>;
      discounts?: Array<{ type: 'PERCENTAGE' | 'FIXED'; value: number }>;
      idempotencyKey: string;
      payments: Array<{ mode: PaymentMode; amount: number; reference?: string }>;
    },
    @Headers() headers: RequestHeaders
  ) {
    return this.sales.checkoutSale(requireOpenRegisterSession(headers), body);
  }

  @Post('/sales/:id/cancel')
  @HttpCode(200)
  cancelSale(@Param('id', ParseUUIDPipe) id: string, @Headers() headers: RequestHeaders) {
    const session = requireOpenRegisterSession(headers);
    requireAdmin(session);
    return this.sales.cancelSale(session, id);
  }

  @Post('/sales/:id/settle')
  @HttpCode(200)
  settleSale(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(appContract.sales.settle.body)) body: { payments: Array<{ mode: PaymentMode; amount: number; reference?: string }> },
    @Headers() headers: RequestHeaders
  ) {
    return this.sales.settleSale(requireOpenRegisterSession(headers), id, body.payments);
  }

  @Get('/sales')
  listSales(
    @Query(new ZodValidationPipe(appContract.sales.list.query)) { branchId }: { branchId: string },
    @Headers() headers: RequestHeaders
  ) {
    const session = requireOpenRegisterSession(headers);
    if (session.branchId !== branchId) {
      throw new BadRequestException('Branch mismatch');
    }
    return this.sales.listSales(branchId);
  }

  @Get('/sales/:id')
  getSaleById(@Param('id', ParseUUIDPipe) id: string, @Headers() headers: RequestHeaders) {
    const session = requireOpenRegisterSession(headers);
    return this.sales.getSaleById(session.branchId!, id);
  }

  /** Online: the receipt by email. 30 an hour per user, so a till can't be used to send mail in bulk. */
  @UseGuards(OnlineOnlyGuard)
  @Post('/sales/:id/email-receipt')
  @HttpCode(202)
  async emailReceipt(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(appContract.sales.emailReceipt.body)) body: { email: string },
    @Headers() headers: RequestHeaders
  ) {
    const session = requireOpenRegisterSession(headers);
    receiptEmailsSent.assertAllowed(session.userId);
    await this.receiptEmails.send(session.branchId!, id, body.email);
    receiptEmailsSent.failed(session.userId);
    return { sent: true as const };
  }

  @Get('/receipts/:id')
  getReceipt(@Param('id', ParseUUIDPipe) id: string, @Headers() headers: RequestHeaders) {
    const session = requireOpenRegisterSession(headers);
    return this.sales.getReceiptById(session.branchId!, id);
  }

  @Get('/receipts/by-invoice/:invoiceId')
  getReceiptsByInvoice(@Param('invoiceId') invoiceId: string, @Headers() headers: RequestHeaders) {
    const session = requireOpenRegisterSession(headers);
    return this.sales.getReceiptsByInvoice(session.branchId!, invoiceId);
  }
}
