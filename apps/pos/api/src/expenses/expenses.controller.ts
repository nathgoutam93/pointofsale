import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { appContract } from '@pos/contracts';
import { AccessService } from '../common/access.service';
import { getSession, requireAdminSession, RequestHeaders } from '../common/request-session';
import { type Parsed, ZodValidationPipe } from '../validation/zod-validation.pipe';
import { ExpensesService } from './expenses.service';

/** Cash in or out of the drawer, and the expense book: admins, and cashiers allowed to. */
@Controller()
export class ExpensesController {
  constructor(
    private readonly expenses: ExpensesService,
    private readonly access: AccessService
  ) {}

  @Post('/registers/cash-movements')
  async cashMovement(
    @Body(new ZodValidationPipe(appContract.expenses.cashMovement.body)) body: Parsed<typeof appContract.expenses.cashMovement.body>,
    @Headers() headers: RequestHeaders
  ) {
    const session = getSession(headers);
    await this.access.requirePermission(session, 'CASH_AND_EXPENSES');
    return this.expenses.cashMovement(session, body);
  }

  @Get('/registers/cash-movements')
  async registerEntries(@Headers() headers: RequestHeaders) {
    const session = getSession(headers);
    await this.access.requirePermission(session, 'CASH_AND_EXPENSES');
    return this.expenses.registerEntries(session);
  }

  @Post('/expenses')
  async create(
    @Body(new ZodValidationPipe(appContract.expenses.create.body)) body: Parsed<typeof appContract.expenses.create.body>,
    @Headers() headers: RequestHeaders
  ) {
    const session = getSession(headers);
    await this.access.requireBranch(session, body.branchId);
    await this.access.requirePermission(session, 'CASH_AND_EXPENSES');
    return this.expenses.create(session, body);
  }

  @Get('/expenses')
  async list(
    @Query(new ZodValidationPipe(appContract.expenses.list.query)) query: Parsed<typeof appContract.expenses.list.query>,
    @Headers() headers: RequestHeaders
  ) {
    const session = getSession(headers);
    await this.access.requireBranch(session, query.branchId);
    await this.access.requirePermission(session, 'CASH_AND_EXPENSES');
    return this.expenses.list(query.branchId, query.from, query.to);
  }

  @Delete('/expenses/:id')
  @HttpCode(200)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(appContract.expenses.remove.body)) body: Parsed<typeof appContract.expenses.remove.body>,
    @Headers() headers: RequestHeaders
  ) {
    const session = requireAdminSession(headers);
    await this.access.requireBranch(session, await this.expenses.branchOf(id));
    return this.expenses.remove(session, id, body.reason);
  }
}
