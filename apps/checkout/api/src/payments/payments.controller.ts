import { createSessionRequestSchema } from '@hackd/checkout-contracts';
import { Body, Controller, Get, Headers, HttpCode, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { providerName } from '../config';
import { PAGE_CSP } from '../common/page';
import { CallingProduct, ProductAuthGuard } from '../common/product-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PaymentsService, type PayTarget, type SessionInput } from './payments.service';

type Headers = Record<string, string | string[] | undefined>;

function send(res: Response, target: PayTarget) {
  if ('redirect' in target) {
    res.redirect(302, target.redirect);
    return;
  }
  res.status(target.status).set('Content-Security-Policy', PAGE_CSP).set('Cache-Control', 'no-store').type('html').send(target.page);
}

@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('/meta')
  meta() {
    return { service: 'checkout', provider: providerName() };
  }

  /** A product starts a payment (see @hackd/checkout-contracts). */
  @Post('/sessions')
  @UseGuards(ProductAuthGuard)
  createSession(@CallingProduct() product: string, @Body(new ZodValidationPipe(createSessionRequestSchema)) body: SessionInput) {
    return this.payments.createSession(product, body);
  }

  @Get('/sessions/:id')
  @UseGuards(ProductAuthGuard)
  session(@CallingProduct() product: string, @Param('id') id: string) {
    return this.payments.session(product, id);
  }

  /** The payer's link (a session's payUrl): on to the provider's page. */
  @Get('/pay/:id')
  async pay(@Param('id') id: string, @Res() res: Response) {
    send(res, await this.payments.payTarget(id));
  }

  /** The provider's notice of a payment. The body arrives unparsed (see app-config.ts) for its signature. */
  @Post('/webhooks/:provider')
  @HttpCode(200)
  webhook(@Param('provider') provider: string, @Req() req: { body?: unknown }, @Headers() headers: Headers) {
    return this.payments.receiveWebhook(provider, Buffer.isBuffer(req.body) ? req.body : undefined, headers);
  }

  /** CHECKOUT_PROVIDER=dummy: the stand-in provider's page. */
  @Get('/dummy/:ref')
  async dummyPage(@Param('ref') ref: string, @Res() res: Response) {
    send(res, await this.payments.dummyPage(ref));
  }

  @Post('/dummy/:ref')
  async dummyComplete(@Param('ref') ref: string, @Body() body: { outcome?: unknown }, @Res() res: Response) {
    send(res, await this.payments.dummyComplete(ref, body?.outcome));
  }
}
