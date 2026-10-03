import { BadRequestException, Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { join } from 'path';
import { appContract, type ReceiptTemplate } from '@pos/contracts';
import { getSession, requireAdminSession, requireAdmin, RequestHeaders } from '../common/request-session';
import { ZodValidationPipe } from '../validation/zod-validation.pipe';
import { uploadsDir } from '../common/uploads';
import { SettingsService } from './settings.service';

@Controller()
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('/business/settings')
  getBusinessSettings(@Headers() headers: RequestHeaders) {
    getSession(headers);
    return this.settings.getBusinessSettings();
  }

  @Patch('/business/settings')
  updateBusinessSettings(
    @Body(new ZodValidationPipe(appContract.business.update.body))
    body: {
      name?: string;
      logoUrl?: string | null;
      gstNumber?: string | null;
      taxCalculationMode?: 'AFTER_DISCOUNT' | 'BEFORE_DISCOUNT';
      cashierMaxDiscountPercent?: number;
      customerScope?: 'SHARED' | 'BRANCH';
      timezone?: string;
      hsnMinDigits?: 4 | 6;
    },
    @Headers() headers: RequestHeaders
  ) {
    requireAdmin(getSession(headers));
    return this.settings.updateBusinessSettings(body);
  }

  @Get('/business/taxpayer-type')
  getTaxpayerType(@Headers() headers: RequestHeaders) {
    getSession(headers);
    return this.settings.getTaxpayerTypeSummary();
  }

  @Post('/business/taxpayer-type')
  changeTaxpayerType(
    @Body(new ZodValidationPipe(appContract.business.changeTaxpayerType.body))
    body: {
      taxpayerType: 'REGULAR' | 'COMPOSITION';
      compositionCategory?: 'MANUFACTURER' | 'TRADER' | 'RESTAURANT' | 'SERVICES' | null;
      effectiveDate: string;
    },
    @Headers() headers: RequestHeaders
  ) {
    const session = getSession(headers);
    requireAdmin(session);
    return this.settings.changeTaxpayerType(session, body);
  }

  @Delete('/business/taxpayer-type/:id')
  cancelTaxpayerTypeChange(@Param('id', ParseUUIDPipe) id: string, @Headers() headers: RequestHeaders) {
    requireAdmin(getSession(headers));
    return this.settings.cancelTaxpayerTypeChange(id);
  }

  @Post('/business/logo')
  @UseInterceptors(
    FileInterceptor('file', {
      dest: join(uploadsDir, 'business'),
      fileFilter: (_req: unknown, file: { mimetype: string }, cb: (error: Error | null, acceptFile: boolean) => void) => {
        if (!file.mimetype?.startsWith('image/')) {
          cb(new BadRequestException('Only image files are allowed'), false);
          return;
        }
        cb(null, true);
      },
      limits: { fileSize: 5 * 1024 * 1024 }
    })
  )
  uploadBusinessLogo(
    @UploadedFile() file: { filename: string } | undefined,
    @Headers() headers: RequestHeaders
  ) {
    requireAdmin(getSession(headers));
    if (!file) {
      throw new BadRequestException('Image file is required');
    }
    return this.settings.updateBusinessSettings({ logoUrl: `/uploads/business/${file.filename}` });
  }

  @Get('/branches/:id')
  getBranch(@Param('id', ParseUUIDPipe) id: string, @Headers() headers: RequestHeaders) {
    const session = getSession(headers);
    if (session.branchId && session.branchId !== id) {
      throw new BadRequestException('Branch mismatch');
    }
    return this.settings.getBranchSettings(id);
  }

  @Patch('/branches/:id')
  updateBranch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(appContract.branches.update.body))
    body: {
      name?: string;
      code?: string;
      logoUrl?: string | null;
      receiptPrefix?: string;
      invoiceHeader?: string | null;
      invoiceFooter?: string | null;
      receiptHeader?: string | null;
      receiptFooter?: string | null;
      invoiceCss?: string | null;
      receiptCss?: string | null;
      receiptTemplate?: ReceiptTemplate | null;
      gstin?: string | null;
      stateCode?: string | null;
    },
    @Headers() headers: RequestHeaders
  ) {
    const session = requireAdminSession(headers);
    if (session.branchId && session.branchId !== id) {
      throw new BadRequestException('Branch mismatch');
    }
    return this.settings.updateBranchSettings(id, body);
  }

  @Post('/branches/:id/logo')
  @UseInterceptors(
    FileInterceptor('file', {
      dest: join(uploadsDir, 'branches'),
      fileFilter: (_req: unknown, file: { mimetype: string }, cb: (error: Error | null, acceptFile: boolean) => void) => {
        if (!file.mimetype?.startsWith('image/')) {
          cb(new BadRequestException('Only image files are allowed'), false);
          return;
        }
        cb(null, true);
      },
      limits: { fileSize: 5 * 1024 * 1024 }
    })
  )
  uploadBranchLogo(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: { filename: string } | undefined,
    @Headers() headers: RequestHeaders
  ) {
    const session = requireAdminSession(headers);
    if (session.branchId && session.branchId !== id) {
      throw new BadRequestException('Branch mismatch');
    }
    if (!file) {
      throw new BadRequestException('Image file is required');
    }
    return this.settings.updateBranchSettings(id, { logoUrl: `/uploads/branches/${file.filename}` });
  }
}
