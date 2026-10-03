import { Controller, Get, Headers, Res, UseGuards } from '@nestjs/common';
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
}
