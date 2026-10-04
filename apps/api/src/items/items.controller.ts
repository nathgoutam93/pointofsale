import type { GstSupplyType } from '@pos/contracts';
import { BadRequestException, Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Patch, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { join } from 'path';
import { appContract } from '@pos/contracts';
import { AccessService } from '../common/access.service';
import { getSession, requireAdminSession, RequestHeaders } from '../common/request-session';
import { ZodValidationPipe } from '../validation/zod-validation.pipe';
import { uploadsDir } from '../common/uploads';
import { ItemsService } from './items.service';

@Controller()
export class ItemsController {
  constructor(
    private readonly items: ItemsService,
    private readonly access: AccessService
  ) {}

  /** The catalogue is the business's: admins, and cashiers allowed to manage items. */
  private managing(headers: RequestHeaders) {
    return this.access.requirePermission(getSession(headers), 'MANAGE_ITEMS');
  }

  @Get('/items')
  listItems(
    @Query(new ZodValidationPipe(appContract.items.list.query)) { activeOnly, branchId }: { activeOnly?: boolean; branchId?: string },
    @Headers() headers: RequestHeaders
  ) {
    return this.items.listItems(getSession(headers), activeOnly === true, branchId);
  }

  @Get('/items/:id/branch-prices')
  listBranchPrices(@Param('id', ParseUUIDPipe) id: string, @Headers() headers: RequestHeaders) {
    return this.items.listBranchPrices(requireAdminSession(headers), id);
  }

  @Put('/items/:id/branch-prices')
  setBranchPrices(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(appContract.items.setBranchPrices.body))
    body: { branchId: string; prices: Array<{ uom: string; sellPrice: number; mrp?: number }> },
    @Headers() headers: RequestHeaders
  ) {
    return this.items.setBranchPrices(requireAdminSession(headers), id, body.branchId, body.prices);
  }

  @Post('/items/upload-image')
  @UseInterceptors(
    FileInterceptor('file', {
      dest: join(uploadsDir, 'items'),
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
  async uploadItemImage(@UploadedFile() file: { filename: string } | undefined, @Headers() headers: RequestHeaders) {
    await this.managing(headers);
    if (!file) {
      throw new BadRequestException('Image file is required');
    }

    return { path: `/uploads/items/${file.filename}` };
  }

  @Post('/items')
  async createItem(
    @Body(new ZodValidationPipe(appContract.items.create.body))
    body: {
      code: string;
      name: string;
      category?: string;
      uom: string;
      leastCount?: number;
      costPrice?: number;
      sellPrice: number;
      mrp?: number;
      saleUoms?: Array<{ uom: string; conversionQty: number; sellPrice: number; mrp?: number }>;
      taxMode?: 'INCLUSIVE' | 'EXCLUSIVE';
      taxRate: number;
      hsnCode?: string | null;
      uqc?: string | null;
      supplyType?: GstSupplyType;
      imageUrl?: string;
      barcodes?: Array<{ barcode: string; saleUom?: string | null }>;
    },
    @Headers() headers: RequestHeaders
  ) {
    await this.managing(headers);
    return this.items.createItem(body);
  }

  @Patch('/items/:id')
  async updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(appContract.items.update.body))
    body: {
      name?: string;
      category?: string | null;
      uom?: string;
      leastCount?: number;
      costPrice?: number;
      sellPrice?: number;
      mrp?: number;
      saleUoms?: Array<{ uom: string; conversionQty: number; sellPrice: number; mrp?: number }>;
      taxMode?: 'INCLUSIVE' | 'EXCLUSIVE';
      taxRate?: number;
      hsnCode?: string | null;
      uqc?: string | null;
      supplyType?: GstSupplyType;
      imageUrl?: string | null;
      isActive?: boolean;
      barcodes?: Array<{ barcode: string; saleUom?: string | null }>;
    },
    @Headers() headers: RequestHeaders
  ) {
    await this.managing(headers);
    return this.items.updateItem(id, body);
  }

  @Delete('/items/:id')
  async deleteItem(@Param('id', ParseUUIDPipe) id: string, @Headers() headers: RequestHeaders) {
    await this.managing(headers);
    return this.items.deleteItem(id);
  }
}
