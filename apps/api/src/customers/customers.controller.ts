import { Body, Controller, Get, HttpCode, Headers, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { appContract } from '@pos/contracts';
import { AccessService } from '../common/access.service';
import { getSession, RequestHeaders } from '../common/request-session';
import type { SessionUser } from '../common/types';
import { ZodValidationPipe } from '../validation/zod-validation.pipe';
import { CustomersService, type BuyerFields } from './customers.service';

@Controller()
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly access: AccessService
  ) {}

  /** The branch named (or the open register's), once the user may manage it. */
  private branch(session: SessionUser, branchId: string | undefined) {
    return this.access.requireBranch(session, branchId ?? session.branchId ?? '');
  }

  private static readonly branchQuery = new ZodValidationPipe(appContract.customers.getWallet.query);

  @Get('/customers')
  async listCustomers(
    @Query(new ZodValidationPipe(appContract.customers.list.query)) { branchId }: { branchId: string },
    @Headers() headers: RequestHeaders
  ) {
    return this.customers.listCustomers(await this.branch(getSession(headers), branchId));
  }

  @Post('/customers')
  async createCustomer(
    @Body(new ZodValidationPipe(appContract.customers.create.body)) body: { branchId: string; name: string; phone?: string } & BuyerFields,
    @Headers() headers: RequestHeaders
  ) {
    await this.branch(getSession(headers), body.branchId);
    return this.customers.createCustomer(body.branchId, body.name, body.phone, body);
  }

  @Patch('/customers/:id')
  async updateCustomer(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(CustomersController.branchQuery) { branchId }: { branchId?: string },
    @Body(new ZodValidationPipe(appContract.customers.update.body)) body: { name?: string; phone?: string | null } & BuyerFields,
    @Headers() headers: RequestHeaders
  ) {
    return this.customers.updateCustomer(await this.branch(getSession(headers), branchId), id, body);
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
    @Body(new ZodValidationPipe(appContract.customers.topupWallet.body)) body: { amount: number; reference?: string },
    @Headers() headers: RequestHeaders
  ) {
    const session = getSession(headers);
    const branch = await this.branch(session, branchId);
    await this.access.requirePermission(session, 'TOP_UP_WALLETS');
    return this.customers.topupWallet(branch, customerId, body.amount, body.reference);
  }
}
