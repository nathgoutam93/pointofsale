import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { CrashReportsService } from './crash-reports.service';

/** Answers errors as Nest does, and keeps a crash report of each unexpected one (a 500). */
@Catch()
export class ServerErrorFilter extends BaseExceptionFilter {
  constructor(
    applicationRef: ConstructorParameters<typeof BaseExceptionFilter>[0],
    private readonly crashes: CrashReportsService
  ) {
    super(applicationRef);
  }

  override catch(exception: unknown, host: ArgumentsHost) {
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    if (status >= 500 && !(exception instanceof HttpException && status === 503)) this.crashes.recordServerError(exception);
    super.catch(exception, host);
  }
}
