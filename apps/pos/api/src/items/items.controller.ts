import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { appContract } from '@pos/contracts';
import { AccessService } from '../common/access.service';
import { getSession, requireAdminSession, RequestHeaders } from '../common/request-session';
import { type Parsed, ZodValidationPipe } from '../validation/zod-validation.pipe';
import { imageUploadOptions, saveImage } from '../common/uploads';
import { ItemsService } from './items.service';
import { ItemImportService } from './item-import.service';

@Controller()
export class ItemsController {
  constructor(
    private readonly items: ItemsService,
    private readonly access: AccessService,
    private readonly itemImport: ItemImportService
  ) {}

  /** The catalogue is the business's: admins, and cashiers allowed to manage items. */
  private managing(headers: RequestHeaders) {
    return this.access.requirePermission(getSession(headers), 'MANAGE_ITEMS');
  }

  @Get('/items')
  listItems(
    @Query(new ZodValidationPipe(appContract.items.list.query)) { activeOnly, branchId }: Parsed<typeof appContract.items.list.query>,
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
    body: Parsed<typeof appContract.items.setBranchPrices.body>,
    @Headers() headers: RequestHeaders
  ) {
    return this.items.setBranchPrices(requireAdminSession(headers), id, body.branchId, body.prices);
  }

  @Post('/items/upload-image')
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  async uploadItemImage(@UploadedFile() file: { buffer?: Buffer } | undefined, @Headers() headers: RequestHeaders) {
    // Checked before anything is saved: the upload is held in memory until then.
    await this.managing(headers);
    return { path: await saveImage(file, 'items') };
  }

  @Post('/items/import')
  @HttpCode(200)
  async importItems(
    @Body(new ZodValidationPipe(appContract.items.import.body)) body: Parsed<typeof appContract.items.import.body>,
    @Headers() headers: RequestHeaders
  ) {
    await this.managing(headers);
    const session = getSession(headers);
    await this.access.requireBranch(session, body.branchId);
    // Opening stock and reorder levels are stock changes; costs only for those who see them.
    const mayChangeStock = await this.access.requirePermission(session, 'MANAGE_STOCK').then(() => true, () => false);
    return this.itemImport.import(session, body, { maySeeCosts: await this.access.maySeeCosts(session), mayChangeStock });
  }

  @Post('/items')
  async createItem(
    @Body(new ZodValidationPipe(appContract.items.create.body))
    body: Parsed<typeof appContract.items.create.body>,
    @Headers() headers: RequestHeaders
  ) {
    await this.managing(headers);
    const session = getSession(headers);
    // Someone who may not see costs can't set one either (the item starts at 0).
    const { costPrice, ...rest } = body;
    return this.items.createItem(session, (await this.access.maySeeCosts(session)) ? body : rest);
  }

  @Patch('/items/:id')
  async updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(appContract.items.update.body))
    body: Parsed<typeof appContract.items.update.body>,
    @Headers() headers: RequestHeaders
  ) {
    await this.managing(headers);
    const session = getSession(headers);
    // Someone who may not see costs leaves the cost as it is.
    const { costPrice, ...rest } = body;
    return this.items.updateItem(session, id, (await this.access.maySeeCosts(session)) ? body : rest);
  }

  @Delete('/items/:id')
  async deleteItem(@Param('id', ParseUUIDPipe) id: string, @Headers() headers: RequestHeaders) {
    await this.managing(headers);
    return this.items.deleteItem(getSession(headers), id);
  }
}
