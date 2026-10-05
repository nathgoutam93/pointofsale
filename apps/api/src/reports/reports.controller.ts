import { Controller, Get, Headers, Query } from '@nestjs/common';
import { appContract } from '@pos/contracts';
import { requireAdminSession, RequestHeaders } from '../common/request-session';
import { type Parsed, ZodValidationPipe } from '../validation/zod-validation.pipe';
import { ReportsService } from './reports.service';

@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('/reports/sales-summary')
  salesSummary(
    @Query(new ZodValidationPipe(appContract.reports.salesSummary.query)) { branchId }: Parsed<typeof appContract.reports.salesSummary.query>,
    @Headers() headers: RequestHeaders
  ) {
    const session = requireAdminSession(headers);
    return this.reports.getSalesSummary(session, branchId);
  }

  @Get('/reports/detail')
  detail(
    @Query(new ZodValidationPipe(appContract.reports.detail.query)) query: Parsed<typeof appContract.reports.detail.query>,
    @Headers() headers: RequestHeaders
  ) {
    return this.reports.getDetail(requireAdminSession(headers), query);
  }
}
