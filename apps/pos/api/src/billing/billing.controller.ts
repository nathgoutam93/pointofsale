import { Body, Controller, Get, Header, Headers, HttpCode, Param, ParseUUIDPipe, Post, Req, Res, UseGuards } from '@nestjs/common';
import { appContract } from '@pos/contracts';
import type { Response } from 'express';
import { Public } from '../auth/auth.guard';
import { AllowWhenUnpaid } from '../common/instance-status.guard';
import { ManagedOnlyGuard } from '../common/mode';
import { getSession, requireAdminSession, type RequestHeaders } from '../common/request-session';
import { type Parsed, ZodValidationPipe } from '../validation/zod-validation.pipe';
import { BillingService } from './billing.service';

/** The pages the payer's browser opens: nothing from elsewhere, no scripts, forms post back here. */
const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'";

/** Managed hosting only. Everything here works while a business is read-only: that's how it pays. */
@Controller()
@UseGuards(ManagedOnlyGuard)
@AllowWhenUnpaid()
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('/billing/status')
  status(@Headers() headers: RequestHeaders) {
    getSession(headers);
    return this.billing.status();
  }

  @Get('/billing')
  summary(@Headers() headers: RequestHeaders) {
    return this.billing.summary(requireAdminSession(headers));
  }

  @Post('/billing/checkout')
  checkout(
    @Body(new ZodValidationPipe(appContract.billing.checkout.body)) body: Parsed<typeof appContract.billing.checkout.body>,
    @Headers() headers: RequestHeaders
  ) {
    return this.billing.checkout(requireAdminSession(headers), body);
  }

  @Get('/billing/invoices/:id')
  invoice(@Param('id', ParseUUIDPipe) id: string, @Headers() headers: RequestHeaders) {
    return this.billing.invoice(requireAdminSession(headers), id);
  }

  /** Opened in the payer's browser (the id is the secret): on to the gateway's page. */
  @Public()
  @Get('/billing/pay/:id')
  async pay(@Param('id') id: string, @Res() res: Response) {
    const target = await this.billing.payTarget(id);
    if ('redirect' in target) {
      res.redirect(302, target.redirect);
      return;
    }
    res.status(200).set('Content-Security-Policy', PAGE_CSP).type('html').send(target.page);
  }

  /** The gateway's notice of a payment. The body arrives unparsed (see app-config.ts) for its signature. */
  @Public()
  @Post('/billing/webhooks/:gateway')
  @HttpCode(200)
  webhook(@Param('gateway') gateway: string, @Req() req: { body?: unknown }, @Headers() headers: RequestHeaders) {
    return this.billing.receiveWebhook(gateway, Buffer.isBuffer(req.body) ? req.body : undefined, headers);
  }

  /** BILLING_GATEWAY=dummy: the stand-in gateway's checkout page. */
  @Public()
  @Get('/billing/dummy/:ref')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Content-Security-Policy', PAGE_CSP)
  dummyPage(@Param('ref') ref: string) {
    return this.billing.dummyPage(ref);
  }

  @Public()
  @Post('/billing/dummy/:ref')
  @HttpCode(200)
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Content-Security-Policy', PAGE_CSP)
  dummyComplete(@Param('ref') ref: string, @Body() body: { outcome?: unknown }) {
    return this.billing.dummyComplete(ref, body?.outcome);
  }
}
