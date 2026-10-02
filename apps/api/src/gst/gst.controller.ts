import { Controller, Get, Headers, Query } from '@nestjs/common';
import { appContract } from '@pos/contracts';
import { requireAdminSession, RequestHeaders } from '../common/request-session';
import { ZodValidationPipe } from '../validation/zod-validation.pipe';
import { GstService } from './gst.service';

@Controller()
export class GstController {
  constructor(private readonly gst: GstService) {}

  @Get('/gst/gstins')
  gstins(@Headers() headers: RequestHeaders) {
    requireAdminSession(headers);
    return this.gst.listGstins();
  }

  @Get('/gst/gstr1')
  gstr1(
    @Query(new ZodValidationPipe(appContract.gst.gstr1.query)) query: { gstin: string; from: string; to: string },
    @Headers() headers: RequestHeaders
  ) {
    requireAdminSession(headers);
    return this.gst.gstr1(query.gstin, query.from, query.to);
  }

  @Get('/gst/gstr3b')
  gstr3b(
    @Query(new ZodValidationPipe(appContract.gst.gstr3b.query)) query: { gstin: string; from: string; to: string },
    @Headers() headers: RequestHeaders
  ) {
    requireAdminSession(headers);
    return this.gst.gstr3b(query.gstin, query.from, query.to);
  }
}
