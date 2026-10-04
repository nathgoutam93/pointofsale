import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Ip, Param, ParseUUIDPipe, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { appContract, EMAIL_VERIFICATION_REQUIRED } from '@pos/contracts';
import { Public } from '../auth/auth.guard';
import { readBearerToken, signAccountToken } from '../auth/token';
import { OnlineOnlyGuard } from '../common/mode';
import { FailureLimiter } from '../common/rate-limit';
import type { RequestHeaders } from '../common/request-session';
import { SetupInput } from '../setup/setup.service';
import { ImportService } from '../tenancy/import.service';
import { ProvisioningService } from '../tenancy/provisioning.service';
import { ZodValidationPipe } from '../validation/zod-validation.pipe';
import { AccountsService } from './accounts.service';

/** Wrong owner passwords: 10 per email and address per 15 minutes. */
const accountFailures = new FailureLimiter(10, 15 * 60 * 1000);
/** Owner password reset emails: 5 per address and 3 per email an hour, against mail floods. */
const resetRequestsByAddress = new FailureLimiter(5, 60 * 60 * 1000);
const resetRequestsByEmail = new FailureLimiter(3, 60 * 60 * 1000);
/** Verification code emails: 5 per address and 3 per email an hour. */
const codeSendsByAddress = new FailureLimiter(5, 60 * 60 * 1000);
const codeSendsByEmail = new FailureLimiter(3, 60 * 60 * 1000);
const isVerificationRequired = (error: unknown) =>
  error instanceof BadRequestException && (error.getResponse() as { code?: unknown })?.code === EMAIL_VERIFICATION_REQUIRED;
/** New businesses: 5 per address per hour, against sign-up floods. */
const creations = new FailureLimiter(5, 60 * 60 * 1000);

/** Hosted server only: owners sign up, create businesses and see theirs. */
@Controller()
@UseGuards(OnlineOnlyGuard)
export class AccountsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly provisioning: ProvisioningService,
    private readonly imports: ImportService
  ) {}

  /**
   * The owner account for an email and password, created on first use, with the verification
   * code when the address isn't verified yet. Counts wrong passwords and codes (not the answer
   * that a code was just sent), and limits code emails.
   */
  private async ownerAccount(input: { email: string; password: string; emailCode?: string }, ip: string) {
    const key = `${ip}|${input.email}`;
    accountFailures.assertAllowed(key);
    if (!input.emailCode) {
      codeSendsByAddress.assertAllowed(ip);
      codeSendsByEmail.assertAllowed(input.email);
    }
    try {
      const account = await this.accounts.findOrCreate(input.email, input.password, input.emailCode);
      accountFailures.succeeded(key);
      return account;
    } catch (error) {
      if (isVerificationRequired(error)) {
        codeSendsByAddress.failed(ip);
        codeSendsByEmail.failed(input.email);
      } else {
        accountFailures.failed(key);
      }
      throw error;
    }
  }

  /** Creates an owner account, or signs in to an existing one (the desktop app's move online uses this). */
  @Public()
  @Post('/accounts/signup')
  @HttpCode(200)
  async signup(
    @Body(new ZodValidationPipe(appContract.accounts.signup.body)) body: { email: string; password: string; emailCode?: string },
    @Ip() ip: string
  ) {
    const account = await this.ownerAccount(body, ip);
    return { token: signAccountToken(account.id), businesses: await this.accounts.businessesOf(account.id) };
  }

  /**
   * Moving online: the desktop app uploads its export (field `bundle`, a zip) with a random
   * `importId`, signed in with an owner token. Answers the new business and its code.
   */
  @Public()
  @Post('/businesses/import')
  @UseInterceptors(FileInterceptor('bundle', { dest: join(tmpdir(), 'pos-imports'), limits: { fileSize: 2 * 1024 * 1024 * 1024 } }))
  async importBusiness(
    @UploadedFile() file: { path: string } | undefined,
    @Body() body: { importId?: unknown },
    @Headers() headers: RequestHeaders
  ) {
    try {
      const accountId = await this.accounts.accountIdFrom(readBearerToken(headers));
      if (!file) throw new BadRequestException('The export file is missing');
      const importId = typeof body?.importId === 'string' ? body.importId : '';
      if (!/^[0-9a-f-]{36}$/i.test(importId)) throw new BadRequestException('importId must be a UUID');
      const imported = await this.imports.importBundle(file.path, { accountId, importId: importId.toLowerCase() });
      await this.accounts.notifyBusinessReady(accountId, imported.business, 'moved');
      return imported;
    } finally {
      if (file) await rm(file.path, { force: true });
    }
  }

  @Public()
  @Post('/businesses')
  async createBusiness(
    @Body(new ZodValidationPipe(appContract.businesses.create.body))
    body: SetupInput & { ownerEmail: string; ownerPassword: string; emailCode?: string },
    @Ip() ip: string
  ) {
    creations.assertAllowed(ip);
    const account = await this.ownerAccount({ email: body.ownerEmail, password: body.ownerPassword, emailCode: body.emailCode }, ip);
    creations.failed(ip);
    const { ownerEmail: _email, ownerPassword: _password, emailCode: _code, ...setup } = body;
    const created = await this.provisioning.createBusiness(setup, { accountId: account.id });
    await this.accounts.notifyBusinessReady(account.id, created.business, 'created');
    return { ...created, accountToken: signAccountToken(account.id) };
  }

  @Public()
  @Post('/accounts/login')
  @HttpCode(200)
  async login(@Body(new ZodValidationPipe(appContract.accounts.login.body)) body: { email: string; password: string }, @Ip() ip: string) {
    const key = `${ip}|${body.email}`;
    accountFailures.assertAllowed(key);
    const account = await this.accounts.login(body.email, body.password).catch((error) => {
      accountFailures.failed(key);
      throw error;
    });
    accountFailures.succeeded(key);
    return { token: signAccountToken(account.id), businesses: await this.accounts.businessesOf(account.id) };
  }

  /** Owner token, not a staff one. */
  @Public()
  @Get('/accounts/businesses')
  async businesses(@Headers() headers: RequestHeaders) {
    return this.accounts.businessesOf(await this.accounts.accountIdFrom(readBearerToken(headers)));
  }

  /** Owner token: the staff of one of their businesses. */
  @Public()
  @Get('/accounts/businesses/:businessId/staff')
  async staff(@Param('businessId', ParseUUIDPipe) businessId: string, @Headers() headers: RequestHeaders) {
    return this.accounts.staffOf(await this.accounts.accountIdFrom(readBearerToken(headers)), businessId);
  }

  /** Owner token: turns a staff user of one of their businesses off or on. */
  @Public()
  @Post('/accounts/staff-active')
  @HttpCode(200)
  async staffActive(
    @Body(new ZodValidationPipe(appContract.accounts.staffActive.body)) body: { businessId: string; username: string; isActive: boolean },
    @Headers() headers: RequestHeaders
  ) {
    return this.accounts.setStaffActive(await this.accounts.accountIdFrom(readBearerToken(headers)), body);
  }

  /** Owner token: a forgotten staff password (usually the business's admin), reset by its owner. */
  @Public()
  @Post('/accounts/staff-password')
  @HttpCode(200)
  async staffPassword(
    @Body(new ZodValidationPipe(appContract.accounts.staffPassword.body)) body: { businessId: string; username: string; newPassword: string },
    @Headers() headers: RequestHeaders
  ) {
    const accountId = await this.accounts.accountIdFrom(readBearerToken(headers));
    return this.accounts.resetStaffPassword(accountId, body);
  }

  /** A forgotten owner password: emails a code. 5 requests per address, 3 per email, an hour. */
  @Public()
  @Post('/accounts/password-reset')
  @HttpCode(202)
  async requestPasswordReset(@Body(new ZodValidationPipe(appContract.accounts.requestPasswordReset.body)) body: { email: string }, @Ip() ip: string) {
    resetRequestsByAddress.assertAllowed(ip);
    resetRequestsByEmail.assertAllowed(body.email);
    resetRequestsByAddress.failed(ip);
    resetRequestsByEmail.failed(body.email);
    await this.accounts.requestPasswordReset(body.email);
    return { sent: true as const };
  }

  @Public()
  @Post('/accounts/password-reset/confirm')
  @HttpCode(200)
  async confirmPasswordReset(
    @Body(new ZodValidationPipe(appContract.accounts.confirmPasswordReset.body)) body: { email: string; code: string; newPassword: string },
    @Ip() ip: string
  ) {
    const key = `${ip}|${body.email}`;
    accountFailures.assertAllowed(key);
    try {
      await this.accounts.confirmPasswordReset(body);
    } catch (error) {
      if (error instanceof BadRequestException) accountFailures.failed(key);
      throw error;
    }
    accountFailures.succeeded(key);
    return { reset: true as const };
  }
}
