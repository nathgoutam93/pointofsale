import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Ip, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { appContract } from '@pos/contracts';
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

  /** Creates an owner account, or signs in to an existing one (the desktop app's move online uses this). */
  @Public()
  @Post('/accounts/signup')
  @HttpCode(200)
  async signup(@Body(new ZodValidationPipe(appContract.accounts.signup.body)) body: { email: string; password: string }, @Ip() ip: string) {
    const key = `${ip}|${body.email}`;
    accountFailures.assertAllowed(key);
    const account = await this.accounts.findOrCreate(body.email, body.password).catch((error) => {
      accountFailures.failed(key);
      throw error;
    });
    accountFailures.succeeded(key);
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
      const accountId = this.accounts.accountIdFrom(readBearerToken(headers));
      if (!file) throw new BadRequestException('The export file is missing');
      const importId = typeof body?.importId === 'string' ? body.importId : '';
      if (!/^[0-9a-f-]{36}$/i.test(importId)) throw new BadRequestException('importId must be a UUID');
      return await this.imports.importBundle(file.path, { accountId, importId: importId.toLowerCase() });
    } finally {
      if (file) await rm(file.path, { force: true });
    }
  }

  @Public()
  @Post('/businesses')
  async createBusiness(
    @Body(new ZodValidationPipe(appContract.businesses.create.body)) body: SetupInput & { ownerEmail: string; ownerPassword: string },
    @Ip() ip: string
  ) {
    const failureKey = `${ip}|${body.ownerEmail}`;
    accountFailures.assertAllowed(failureKey);
    creations.assertAllowed(ip);
    const account = await this.accounts.findOrCreate(body.ownerEmail, body.ownerPassword).catch((error) => {
      accountFailures.failed(failureKey);
      throw error;
    });
    accountFailures.succeeded(failureKey);
    creations.failed(ip);
    const { ownerEmail: _email, ownerPassword: _password, ...setup } = body;
    const created = await this.provisioning.createBusiness(setup, { accountId: account.id });
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
  businesses(@Headers() headers: RequestHeaders) {
    return this.accounts.businessesOf(this.accounts.accountIdFrom(readBearerToken(headers)));
  }
}
