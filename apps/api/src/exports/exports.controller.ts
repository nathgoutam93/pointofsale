import { BadRequestException, Controller, Get, Headers, Query, Res, UseGuards } from '@nestjs/common';
import { salesExportQuerySchema } from '@pos/contracts';
import { createReadStream } from 'fs';
import { rm } from 'fs/promises';
import type { ServerResponse } from 'http';
import { AccessService } from '../common/access.service';
import { OnlineOnlyGuard } from '../common/mode';
import { requireAdminSession, type RequestHeaders } from '../common/request-session';
import { BranchesService } from '../branches/branches.service';
import { PrismaService } from '../prisma.service';
import { currentBusiness } from '../tenancy/tenant-context';
import { ZodValidationPipe } from '../validation/zod-validation.pipe';
import { ExportsService } from './exports.service';

const fileDay = () => new Date().toISOString().slice(0, 10);

/** Names the download, readable by the web app on another origin too. */
function attachment(res: ServerResponse, type: string, name: string) {
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
}

/** Taking a business's data away: all of it, or its sales register. Admins only. */
@Controller()
export class ExportsController {
  constructor(
    private readonly exports: ExportsService,
    private readonly access: AccessService,
    private readonly branches: BranchesService,
    private readonly prisma: PrismaService
  ) {}

  /**
   * Online: every table of the business with its pictures, as a backup file that an offline
   * install restores (Settings → Backups → Restore from a file). For an admin of every branch,
   * since it holds them all. (Offline businesses have their backups already.)
   */
  @Get('/exports/business')
  @UseGuards(OnlineOnlyGuard)
  async business(@Headers() headers: RequestHeaders, @Res() res: ServerResponse) {
    const session = requireAdminSession(headers);
    const [mine, all] = await Promise.all([this.branches.listAccessibleBranches(session), this.prisma.branch.count()]);
    if (mine.length < all) throw new BadRequestException("The export holds every branch's data: only an admin of every branch can download it.");
    const { file, dir, done } = await this.exports.fullExport();
    attachment(res, 'application/zip', `pos-export-${currentBusiness()?.code ?? 'business'}-${fileDay()}.zip`);
    res.on('close', () => {
      done();
      void rm(dir, { recursive: true, force: true });
    });
    createReadStream(file)
      .on('error', (error) => res.destroy(error))
      .pipe(res);
  }

  /** The sales register for a period, as CSV: invoices and credit notes with their tax split. */
  @Get('/exports/sales.csv')
  async sales(
    @Query(new ZodValidationPipe(salesExportQuerySchema)) query: { branchId?: string; from: string; to: string },
    @Headers() headers: RequestHeaders,
    @Res() res: ServerResponse
  ) {
    const session = requireAdminSession(headers);
    const branchIds = query.branchId
      ? [await this.access.requireBranch(session, query.branchId)]
      : (await this.branches.listAccessibleBranches(session)).map((branch) => branch.id);
    const csv = await this.exports.salesCsv(branchIds, query.from, query.to);
    attachment(res, 'text/csv; charset=utf-8', `sales-${query.from}-to-${query.to}.csv`);
    res.end(csv);
  }
}
