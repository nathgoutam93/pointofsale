import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { appContract } from '@pos/contracts';
import { AccessService } from '../common/access.service';
import { getSession, RequestHeaders } from '../common/request-session';
import { type Parsed, ZodValidationPipe } from '../validation/zod-validation.pipe';
import { ItemGroupsService } from './item-groups.service';

/** Products with size/colour variants: anyone may list them; item managers change them. */
@Controller()
export class ItemGroupsController {
  constructor(
    private readonly groups: ItemGroupsService,
    private readonly access: AccessService
  ) {}

  private async managing(headers: RequestHeaders) {
    const session = getSession(headers);
    await this.access.requirePermission(session, 'MANAGE_ITEMS');
    return session;
  }

  @Get('/item-groups')
  list(@Headers() headers: RequestHeaders) {
    getSession(headers);
    return this.groups.list();
  }

  @Post('/item-groups')
  async create(
    @Body(new ZodValidationPipe(appContract.itemGroups.create.body)) body: Parsed<typeof appContract.itemGroups.create.body>,
    @Headers() headers: RequestHeaders
  ) {
    const session = await this.managing(headers);
    // Someone who may not see costs can't set one either (the items start at 0).
    const { costPrice, ...rest } = body;
    return this.groups.create(session, (await this.access.maySeeCosts(session)) ? body : rest);
  }

  @Post('/item-groups/:id/values')
  @HttpCode(200)
  async addValues(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(appContract.itemGroups.addValues.body)) body: Parsed<typeof appContract.itemGroups.addValues.body>,
    @Headers() headers: RequestHeaders
  ) {
    return this.groups.addValues(await this.managing(headers), id, body);
  }

  @Patch('/item-groups/:id/prices')
  async setPrices(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(appContract.itemGroups.setPrices.body)) body: Parsed<typeof appContract.itemGroups.setPrices.body>,
    @Headers() headers: RequestHeaders
  ) {
    return this.groups.setPrices(await this.managing(headers), id, body);
  }
}
