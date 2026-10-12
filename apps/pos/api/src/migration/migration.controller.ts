import { Body, Controller, Get, Headers, HttpCode, Post, Res, UseGuards } from '@nestjs/common';
import { migrationCompleteBodySchema } from '@pos/contracts';
import { AllowWhenLocked } from '../common/instance-status.guard';
import { type Parsed, ZodValidationPipe } from '../validation/zod-validation.pipe';
import type { ServerResponse } from 'http';
import { getSession, requireAdmin, RequestHeaders } from '../common/request-session';
import { OfflineOnlyGuard } from '../common/mode';
import { ExportService } from './export.service';

@Controller()
export class MigrationController {
  constructor(private readonly exporter: ExportService) {}

  /**
   * Offline only, admins only: the whole business as a zip bundle, for moving it online.
   * Refused (409) while a register is open, so no sale is half-way through.
   */
  @Get('/migration/export')
  @UseGuards(OfflineOnlyGuard)
  async export(@Headers() headers: RequestHeaders, @Res() res: ServerResponse) {
    requireAdmin(getSession(headers));
    await this.exporter.assertCanExport();
    // Everything that can fail with a clear error happens before the first byte is sent.
    const prepared = await this.exporter.prepare();
    const stamp = prepared.manifest.exportedAt.replace(/[:.]/g, '-');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="pos-export-${stamp}.zip"`);
    try {
      await this.exporter.stream(prepared, res);
    } catch (error) {
      // Headers are already sent, so the only signal left is cutting the response short.
      res.destroy(error instanceof Error ? error : undefined);
    }
  }

  /** Moving online, step 1: pause changes here (refused while a register is open). */
  @Post('/migration/begin')
  @HttpCode(200)
  @UseGuards(OfflineOnlyGuard)
  begin(@Headers() headers: RequestHeaders) {
    requireAdmin(getSession(headers));
    return this.exporter.beginMove();
  }

  /** The move failed or was cancelled: this computer carries on as before. */
  @Post('/migration/abort')
  @HttpCode(200)
  @AllowWhenLocked()
  @UseGuards(OfflineOnlyGuard)
  abort(@Headers() headers: RequestHeaders) {
    requireAdmin(getSession(headers));
    return this.exporter.abortMove();
  }

  /** The server has the business: this copy becomes read-only and points to it. */
  @Post('/migration/complete')
  @HttpCode(200)
  @AllowWhenLocked()
  @UseGuards(OfflineOnlyGuard)
  complete(
    @Body(new ZodValidationPipe(migrationCompleteBodySchema)) body: Parsed<typeof migrationCompleteBodySchema>,
    @Headers() headers: RequestHeaders
  ) {
    requireAdmin(getSession(headers));
    return this.exporter.completeMove(body);
  }
}
