import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { appContract } from '@pos/contracts';
import { AccessService } from '../common/access.service';
import { OnlineOnlyGuard } from '../common/mode';
import { FailureLimiter } from '../common/rate-limit';
import { getSession, requireAdminSession, requireOpenRegisterSession, RequestHeaders } from '../common/request-session';
import type { SessionUser } from '../common/types';
import { ZodValidationPipe } from '../validation/zod-validation.pipe';
import { CustomersService, type BuyerFields, type CreditFields } from './customers.service';
import { ReceivablesService } from './receivables.service';

/** Statements emailed, per user: 30 an hour, so the server can't be used to send mail in bulk. */
const statementEmailsSent = new FailureLimiter(30, 60 * 60 * 1000);

/** Only admins give credit: setting a credit limit or payment terms. */
function assertMaySetCredit(session: SessionUser, body: CreditFields) {
  if ((body.creditLimit !== undefined || body.paymentTermsDays !== undefined) && session.role !== UserRole.ADMIN) {
    throw new ForbiddenException('Only admins set credit limits and payment terms');
  }
}

@Controller()
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly receivables: ReceivablesService,
    private readonly access: AccessService
  ) {}

  /** The branch named (or the open register's), once the user may manage it. */
  private branch(session: SessionUser, branchId: string | undefined) {
    return this.access.requireBranch(session, branchId ?? session.branchId ?? '');
  }

  private static readonly branchQuery = new ZodValidationPipe(appContract.customers.getWallet.query);
  private static readonly statementQuery = new ZodValidationPipe(appContract.customers.statement.query);

  @Get('/customers')
  async listCustomers(
    @Query(new ZodValidationPipe(appContract.customers.list.query)) { branchId }: { branchId: string },
    @Headers() headers: RequestHeaders
  ) {
    return this.customers.listCustomers(await this.branch(getSession(headers), branchId));
  }

  @Post('/customers')
  async createCustomer(
    @Body(new ZodValidationPipe(appContract.customers.create.body)) body: { branchId: string; name: string; phone?: string } & BuyerFields & CreditFields,
    @Headers() headers: RequestHeaders
  ) {
    const session = getSession(headers);
    await this.branch(session, body.branchId);
    assertMaySetCredit(session, body);
    return this.customers.createCustomer(body.branchId, body.name, body.phone, body);
  }

  @Patch('/customers/:id')
  async updateCustomer(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(CustomersController.branchQuery) { branchId }: { branchId?: string },
    @Body(new ZodValidationPipe(appContract.customers.update.body)) body: { name?: string; phone?: string | null } & BuyerFields & CreditFields,
    @Headers() headers: RequestHeaders
  ) {
    const session = getSession(headers);
    const branch = await this.branch(session, branchId);
    assertMaySetCredit(session, body);
    return this.customers.updateCustomer(branch, id, body);
  }

  @Get('/customers/ageing')
  async ageing(
    @Query(new ZodValidationPipe(appContract.customers.ageing.query)) { branchId }: { branchId: string },
    @Headers() headers: RequestHeaders
  ) {
    return this.receivables.ageing(await this.branch(getSession(headers), branchId));
  }

  @Get('/customers/:id/account')
  async account(
    @Param('id', ParseUUIDPipe) customerId: string,
    @Query(CustomersController.branchQuery) { branchId }: { branchId?: string },
    @Headers() headers: RequestHeaders
  ) {
    return this.receivables.account(await this.branch(getSession(headers), branchId), customerId);
  }

  @Get('/customers/:id/statement')
  async statement(
    @Param('id', ParseUUIDPipe) customerId: string,
    @Query(CustomersController.statementQuery) query: { branchId?: string; from: string; to: string },
    @Headers() headers: RequestHeaders
  ) {
    return this.receivables.statement(await this.branch(getSession(headers), query.branchId), customerId, query.from, query.to);
  }

  /** Online: the statement by email. */
  @UseGuards(OnlineOnlyGuard)
  @Post('/customers/:id/statement/email')
  @HttpCode(202)
  async emailStatement(
    @Param('id', ParseUUIDPipe) customerId: string,
    @Query(CustomersController.branchQuery) { branchId }: { branchId?: string },
    @Body(new ZodValidationPipe(appContract.customers.emailStatement.body)) body: { from: string; to: string; email: string },
    @Headers() headers: RequestHeaders
  ) {
    const session = getSession(headers);
    const branch = await this.branch(session, branchId);
    statementEmailsSent.assertAllowed(session.userId);
    await this.receivables.emailStatement(branch, customerId, body.from, body.to, body.email);
    statementEmailsSent.failed(session.userId);
    return { sent: true as const };
  }

  @Get('/customers/walk-in/:branchId')
  async getWalkIn(@Param('branchId', ParseUUIDPipe) branchId: string, @Headers() headers: RequestHeaders) {
    return this.customers.getWalkIn(await this.branch(getSession(headers), branchId));
  }

  @Get('/customers/:id/wallet')
  async getWallet(
    @Param('id', ParseUUIDPipe) customerId: string,
    @Query(CustomersController.branchQuery) { branchId }: { branchId?: string },
    @Headers() headers: RequestHeaders
  ) {
    return this.customers.getWallet(await this.branch(getSession(headers), branchId), customerId);
  }

  @Post('/customers/:id/wallet/topup')
  @HttpCode(200)
  async topupWallet(
    @Param('id', ParseUUIDPipe) customerId: string,
    @Query(CustomersController.branchQuery) { branchId }: { branchId?: string },
    @Body(new ZodValidationPipe(appContract.customers.topupWallet.body)) body: { amount: number; mode: 'CASH' | 'CARD' | 'UPI'; reference?: string },
    @Headers() headers: RequestHeaders
  ) {
    // Money is taken, so it lands on the open register, at its branch.
    const session = requireOpenRegisterSession(headers);
    if (branchId && branchId !== session.branchId) {
      throw new BadRequestException("Top up at the branch of your open register");
    }
    const branch = await this.branch(session, session.branchId);
    await this.access.requirePermission(session, 'TOP_UP_WALLETS');
    return this.customers.topupWallet(session, branch, customerId, body);
  }

  @Post('/customers/:id/wallet/adjust')
  @HttpCode(200)
  async adjustWallet(
    @Param('id', ParseUUIDPipe) customerId: string,
    @Query(CustomersController.branchQuery) { branchId }: { branchId?: string },
    @Body(new ZodValidationPipe(appContract.customers.adjustWallet.body)) body: { amount: number; reason: string },
    @Headers() headers: RequestHeaders
  ) {
    const session = requireAdminSession(headers);
    const branch = await this.branch(session, branchId);
    return this.customers.adjustWallet(session, branch, customerId, body.amount, body.reason);
  }
}
