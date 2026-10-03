import { BadRequestException, Body, Controller, Get, HttpCode, Headers, Ip, Post, UseGuards } from '@nestjs/common';
import { appContract } from '@pos/contracts';
import { Public } from '../auth/auth.guard';
import { AllowWhenLocked } from '../common/instance-status.guard';
import { getSession, RequestHeaders } from '../common/request-session';
import { ZodValidationPipe } from '../validation/zod-validation.pipe';
import { AuthService } from './auth.service';
import { isOffline, OfflineOnlyGuard } from '../common/mode';
import { requireAdminSession } from '../common/request-session';
import { RecoveryService } from './recovery.service';
import { FailureLimiter } from '../common/rate-limit';
import { TenancyService } from '../tenancy/tenancy.service';

/** 10 wrong passwords for one user from one address lock that pair out for 15 minutes. */
const loginFailures = new FailureLimiter(10, 15 * 60 * 1000);
/** Wrong recovery codes: 5 per address per 15 minutes (the code is long; this stops scripts). */
const recoveryFailures = new FailureLimiter(5, 15 * 60 * 1000);

@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tenancy: TenancyService,
    private readonly recovery: RecoveryService
  ) {}

  /** Offline: a forgotten admin password, reset with the recovery code. Works even once the business has moved (to read its history). */
  @Public()
  @AllowWhenLocked()
  @UseGuards(OfflineOnlyGuard)
  @Post('/auth/recover')
  @HttpCode(200)
  async recover(
    @Body(new ZodValidationPipe(appContract.auth.recover.body)) body: { recoveryCode: string; username: string; newPassword: string },
    @Ip() ip: string
  ) {
    recoveryFailures.assertAllowed(ip);
    try {
      const result = await this.recovery.recover(body);
      recoveryFailures.succeeded(ip);
      return result;
    } catch (error) {
      if (error instanceof BadRequestException) recoveryFailures.failed(ip);
      throw error;
    }
  }

  @UseGuards(OfflineOnlyGuard)
  @Get('/auth/recovery-code')
  recoveryCodeStatus(@Headers() headers: RequestHeaders) {
    requireAdminSession(headers);
    return this.recovery.status();
  }

  @UseGuards(OfflineOnlyGuard)
  @Post('/auth/recovery-code')
  async newRecoveryCode(@Headers() headers: RequestHeaders) {
    requireAdminSession(headers);
    return { recoveryCode: await this.recovery.replaceCode() };
  }

  @Public()
  @AllowWhenLocked()
  @Post('/auth/login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(appContract.auth.login.body)) body: { businessCode?: string; username: string; password: string },
    @Ip() ip: string
  ) {
    const key = `${ip}|${body.businessCode ?? ''}|${body.username}`;
    loginFailures.assertAllowed(key);
    try {
      // Hosted server: staff sign in to one business, named by its code.
      if (!isOffline()) await this.tenancy.enterByCode(body.businessCode);
      const session = await this.auth.login(body.username, body.password);
      loginFailures.succeeded(key);
      return session;
    } catch (error) {
      if (error instanceof BadRequestException) loginFailures.failed(key);
      throw error;
    }
  }

  @Get('/auth/me')
  me(@Headers() headers: RequestHeaders) {
    return this.auth.me(getSession(headers));
  }
}
