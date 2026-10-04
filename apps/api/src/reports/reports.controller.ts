import { Controller, Get, Headers, Query } from '@nestjs/common';
import { appContract } from '@pos/contracts';
import { requireAdminSession, RequestHeaders } from '../common/request-session';
import { ZodValidationPipe } from '../validation/zod-validation.pipe';
import { ReportsService } from './reports.service';

@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('/reports/sales-summary')
  salesSummary(
    @Query(new ZodValidationPipe(appContract.reports.salesSummary.query)) { branchId }: { branchId: string },
    @Headers() headers: RequestHeaders
  ) {
    const session = requireAdminSession(headers);
    return this.reports.getSalesSummary(session, branchId);
  }

  @Get('/reports/detail')
  detail(
    @Query(new ZodValidationPipe(appContract.reports.detail.query)) query: { branchId?: string; from: string; to: string },
    @Headers() headers: RequestHeaders
  ) {
    return this.reports.getDetail(requireAdminSession(headers), query);
  }
}
