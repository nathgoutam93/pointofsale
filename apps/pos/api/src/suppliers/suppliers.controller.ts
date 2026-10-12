import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { appContract } from '@pos/contracts';
import { AccessService } from '../common/access.service';
import { getSession, RequestHeaders } from '../common/request-session';
import { type Parsed, ZodValidationPipe } from '../validation/zod-validation.pipe';
import { SuppliersService } from './suppliers.service';

/** Suppliers are business-wide; anyone who records purchases or pays suppliers sees them. */
@Controller()
export class SuppliersController {
  constructor(
    private readonly suppliers: SuppliersService,
    private readonly access: AccessService
  ) {}

  @Get('/suppliers')
  async list(
    @Query(new ZodValidationPipe(appContract.suppliers.list.query)) query: Parsed<typeof appContract.suppliers.list.query>,
    @Headers() headers: RequestHeaders
  ) {
    await this.access.requireAnyPermission(getSession(headers), ['RECORD_PURCHASES', 'PAY_SUPPLIERS']);
    return this.suppliers.list(query.includeInactive === 'true');
  }

  @Post('/suppliers')
  async create(
    @Body(new ZodValidationPipe(appContract.suppliers.create.body)) body: Parsed<typeof appContract.suppliers.create.body>,
    @Headers() headers: RequestHeaders
  ) {
    const session = getSession(headers);
    await this.access.requirePermission(session, 'RECORD_PURCHASES');
    return this.suppliers.create(session, body);
  }

  @Patch('/suppliers/:id')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(appContract.suppliers.update.body)) body: Parsed<typeof appContract.suppliers.update.body>,
    @Headers() headers: RequestHeaders
  ) {
    const session = getSession(headers);
    await this.access.requirePermission(session, 'RECORD_PURCHASES');
    return this.suppliers.update(session, id, body);
  }

  @Get('/suppliers/:id/account')
  async account(@Param('id', new ParseUUIDPipe()) id: string, @Headers() headers: RequestHeaders) {
    await this.access.requireAnyPermission(getSession(headers), ['RECORD_PURCHASES', 'PAY_SUPPLIERS']);
    return this.suppliers.account(id);
  }

  @Post('/suppliers/:id/payments')
  async pay(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(appContract.suppliers.pay.body)) body: Parsed<typeof appContract.suppliers.pay.body>,
    @Headers() headers: RequestHeaders
  ) {
    const session = getSession(headers);
    await this.access.requireBranch(session, body.branchId);
    await this.access.requirePermission(session, 'PAY_SUPPLIERS');
    return this.suppliers.pay(session, id, body);
  }
}
