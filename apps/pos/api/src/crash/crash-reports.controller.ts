import { Body, Controller, Headers, HttpCode, Ip, Post, UseGuards } from '@nestjs/common';
import { crashReportsBodySchema } from '@pos/contracts';
import { Public } from '../auth/auth.guard';
import { readBearerToken, verifyToken } from '../auth/token';
import { OnlineOnlyGuard } from '../common/mode';
import { FailureLimiter } from '../common/rate-limit';
import type { RequestHeaders } from '../common/request-session';
import { type Parsed, ZodValidationPipe } from '../validation/zod-validation.pipe';
import { CrashReportsService } from './crash-reports.service';

/** 60 deliveries an hour per address: an app in a crash loop can't fill the table. */
const deliveries = new FailureLimiter(60, 60 * 60 * 1000);

/** Online server: crash reports from apps, signed in or not (an offline install sends here too). */
@Controller()
@UseGuards(OnlineOnlyGuard)
export class CrashReportsController {
  constructor(private readonly crashes: CrashReportsService) {}

  @Public()
  @Post('/crash-reports')
  @HttpCode(202)
  async report(@Body(new ZodValidationPipe(crashReportsBodySchema)) body: Parsed<typeof crashReportsBodySchema>, @Headers() headers: RequestHeaders, @Ip() ip: string) {
    deliveries.assertAllowed(ip);
    deliveries.failed(ip);
    // The business, only when a signed-in page sends it (the token is checked, never trusted blindly).
    const token = readBearerToken(headers);
    const session = token ? verifyToken(token) : null;
    await this.crashes.record(body.reports, session?.businessId ?? null);
    return { received: body.reports.length };
  }
}
