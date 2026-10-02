import { BadRequestException, Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { join } from 'path';
import { appContract } from '@pos/contracts';
import { getSession, requireAdminSession, RequestHeaders } from '../common/request-session';
import { ZodValidationPipe } from '../validation/zod-validation.pipe';
import { uploadsDir } from '../common/uploads';
import { ItemsService } from './items.service';

@Controller()
export class ItemsController {
  constructor(private readonly items: ItemsService) {}

  @Get('/items')
  listItems(
    @Query(new ZodValidationPipe(appContract.items.list.query)) { activeOnly }: { activeOnly?: boolean },
    @Headers() headers: RequestHeaders
  ) {
    getSession(headers);
    return this.items.listItems(activeOnly === true);
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
  uploadItemImage(@UploadedFile() file: { filename: string } | undefined, @Headers() headers: RequestHeaders) {
    requireAdminSession(headers);
    if (!file) {
      throw new BadRequestException('Image file is required');
    }

    return { path: `/uploads/items/${file.filename}` };
  }

  @Post('/items')
  createItem(
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
      imageUrl?: string;
    },
    @Headers() headers: RequestHeaders
  ) {
    requireAdminSession(headers);
    return this.items.createItem(body);
  }

  @Patch('/items/:id')
  updateItem(
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
      imageUrl?: string | null;
      isActive?: boolean;
    },
    @Headers() headers: RequestHeaders
  ) {
    requireAdminSession(headers);
    return this.items.updateItem(id, body);
  }

  @Delete('/items/:id')
  deleteItem(@Param('id', ParseUUIDPipe) id: string, @Headers() headers: RequestHeaders) {
    requireAdminSession(headers);
    return this.items.deleteItem(id);
  }
}
