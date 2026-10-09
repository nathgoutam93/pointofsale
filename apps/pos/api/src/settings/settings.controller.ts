import { Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { appContract } from '@pos/contracts';
import { getSession, requireAdminSession, requireAdmin, RequestHeaders } from '../common/request-session';
import { type Parsed, ZodValidationPipe } from '../validation/zod-validation.pipe';
import { imageUploadOptions, saveImage } from '../common/uploads';
import { SettingsService } from './settings.service';
import { AccessService } from '../common/access.service';
import { BranchesService } from '../branches/branches.service';
import { AuditService } from '../common/audit.service';

@Controller()
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly access: AccessService,
    private readonly branches: BranchesService,
    private readonly audit: AuditService
  ) {}

  @Get('/business/settings')
  getBusinessSettings(@Headers() headers: RequestHeaders) {
    getSession(headers);
    return this.settings.getBusinessSettings();
  }

  @Patch('/business/settings')
  async updateBusinessSettings(
    @Body(new ZodValidationPipe(appContract.business.update.body))
    body: Parsed<typeof appContract.business.update.body>,
    @Headers() headers: RequestHeaders
  ) {
    const session = getSession(headers);
    requireAdmin(session);
    const before = await this.settings.getBusinessSettings();
    const after = await this.settings.updateBusinessSettings(body);
    const changes = AuditService.changes(before, after, Object.keys(body));
    if (Object.keys(changes).length > 0) {
      await this.audit.record(session, {
        action: 'BUSINESS_SETTINGS_CHANGED',
        entityType: 'BusinessSettings',
        summary: `Changed business settings: ${Object.keys(changes).join(', ')}`,
        details: { changes } as never
      });
    }
    return after;
  }

  @Get('/business/taxpayer-type')
  getTaxpayerType(@Headers() headers: RequestHeaders) {
    getSession(headers);
    return this.settings.getTaxpayerTypeSummary();
  }

  @Post('/business/taxpayer-type')
  async changeTaxpayerType(
    @Body(new ZodValidationPipe(appContract.business.changeTaxpayerType.body))
    body: Parsed<typeof appContract.business.changeTaxpayerType.body>,
    @Headers() headers: RequestHeaders
  ) {
    const session = getSession(headers);
    requireAdmin(session);
    const change = await this.settings.changeTaxpayerType(session, body);
    await this.audit.record(session, {
      action: 'TAXPAYER_TYPE_CHANGED',
      entityType: 'BusinessSettings',
      summary: `GST registration set to ${body.taxpayerType.toLowerCase()}${body.compositionCategory ? ` (${body.compositionCategory.toLowerCase()})` : ''} from ${body.effectiveDate}`,
      details: body
    });
    return change;
  }

  @Delete('/business/taxpayer-type/:id')
  cancelTaxpayerTypeChange(@Param('id', ParseUUIDPipe) id: string, @Headers() headers: RequestHeaders) {
    requireAdmin(getSession(headers));
    return this.settings.cancelTaxpayerTypeChange(id);
  }

  @Post('/business/logo')
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  async uploadBusinessLogo(
    @UploadedFile() file: { buffer?: Buffer } | undefined,
    @Headers() headers: RequestHeaders
  ) {
    requireAdmin(getSession(headers));
    return this.settings.updateBusinessSettings({ logoUrl: await saveImage(file, 'business') });
  }

  @Get('/branches/:id')
  async getBranch(@Param('id', ParseUUIDPipe) id: string, @Headers() headers: RequestHeaders) {
    const branch = await this.settings.getBranchSettings(id);
    // Read by anyone who works at the branch (receipts print its header and logo).
    await this.branches.ensureUserHasBranchAccess(getSession(headers).userId, id);
    return branch;
  }

  @Patch('/branches/:id')
  async updateBranch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(appContract.branches.update.body))
    body: Parsed<typeof appContract.branches.update.body>,
    @Headers() headers: RequestHeaders
  ) {
    const session = requireAdminSession(headers);
    await this.access.requireBranch(session, id);
    const before = await this.settings.getBranchSettings(id);
    const after = await this.settings.updateBranchSettings(id, body);
    const changes = AuditService.changes(before as Record<string, unknown>, after as Record<string, unknown>, Object.keys(body));
    if (Object.keys(changes).length > 0) {
      await this.audit.record(session, {
        action: 'BRANCH_SETTINGS_CHANGED',
        entityType: 'Branch',
        entityId: id,
        branchId: id,
        summary: `Changed branch settings: ${Object.keys(changes).join(', ')}`,
        details: { changes } as never
      });
    }
    return after;
  }

  @Post('/branches/:id/logo')
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  async uploadBranchLogo(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: { buffer?: Buffer } | undefined,
    @Headers() headers: RequestHeaders
  ) {
    await this.access.requireBranch(requireAdminSession(headers), id);
    return this.settings.updateBranchSettings(id, { logoUrl: await saveImage(file, 'branches') });
  }
}
