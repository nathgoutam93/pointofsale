import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
  UnauthorizedException
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { join } from 'path';
import { PaymentMode, UserRole } from '@prisma/client';
import { PosService } from './pos.service';
import { SessionUser } from './pos.types';

@Controller()
export class PosController {
  constructor(private readonly posService: PosService) {}

  private getSession(headers: Record<string, string | string[] | undefined>): SessionUser {
    const authorization = headers.authorization;
    const authValue = Array.isArray(authorization) ? authorization[0] : authorization;
    if (!authValue || !authValue.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    try {
      const token = authValue.slice('Bearer '.length);
      const decoded = Buffer.from(token, 'base64').toString('utf8');
      const [userId, role, branchId] = decoded.split(':');

      if (!userId || !branchId || !role) {
        throw new UnauthorizedException('Invalid token');
      }

      if (role !== UserRole.ADMIN && role !== UserRole.CASHIER) {
        throw new UnauthorizedException('Invalid role');
      }

      return { userId, branchId, role };
    } catch {
      throw new UnauthorizedException('Invalid bearer token');
    }
  }

  private requireAdmin(session: SessionUser) {
    if (session.role !== UserRole.ADMIN) {
      throw new BadRequestException('Admin role required');
    }
  }

  @Post('/auth/login')
  @HttpCode(200)
  login(@Body() body: { username: string; password: string }) {
    return this.posService.login(body.username, body.password);
  }

  @Get('/auth/me')
  me(@Headers() headers: Record<string, string | string[] | undefined>) {
    return this.posService.me(this.getSession(headers));
  }

  @Get('/customers')
  listCustomers(@Query('branchId') branchId: string) {
    return this.posService.listCustomers(branchId);
  }

  @Post('/customers')
  createCustomer(
    @Body() body: { branchId: string; name: string; phone?: string },
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    this.getSession(headers);
    return this.posService.createCustomer(body.branchId, body.name, body.phone);
  }

  @Get('/customers/walk-in/:branchId')
  getWalkIn(@Param('branchId') branchId: string) {
    return this.posService.getWalkIn(branchId);
  }

  @Get('/customers/:id/wallet')
  getWallet(@Param('id') customerId: string) {
    return this.posService.getWallet(customerId);
  }

  @Post('/customers/:id/wallet/topup')
  @HttpCode(200)
  topupWallet(
    @Param('id') customerId: string,
    @Body() body: { amount: number; reference?: string },
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    this.requireAdmin(this.getSession(headers));
    return this.posService.topupWallet(customerId, body.amount, body.reference);
  }

  @Get('/items')
  listItems(@Query('activeOnly') activeOnly?: string) {
    return this.posService.listItems(activeOnly === 'true');
  }

  @Post('/items/upload-image')
  @UseInterceptors(
    FileInterceptor('file', {
      dest: join(process.cwd(), 'uploads', 'items'),
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
  uploadItemImage(@UploadedFile() file: { filename: string } | undefined, @Headers() headers: Record<string, string | string[] | undefined>) {
    this.requireAdmin(this.getSession(headers));
    if (!file) {
      throw new BadRequestException('Image file is required');
    }

    return { path: `/uploads/items/${file.filename}` };
  }

  @Post('/items')
  createItem(
    @Body()
    body: {
      code: string;
      name: string;
      category?: string;
      uom: string;
      costPrice?: number;
      sellPrice: number;
      taxMode?: 'INCLUSIVE' | 'EXCLUSIVE';
      taxRate: number;
      imageUrl?: string;
    },
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    this.requireAdmin(this.getSession(headers));
    return this.posService.createItem(body);
  }

  @Patch('/items/:id')
  updateItem(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      category?: string | null;
      uom?: string;
      costPrice?: number;
      sellPrice?: number;
      taxMode?: 'INCLUSIVE' | 'EXCLUSIVE';
      taxRate?: number;
      imageUrl?: string | null;
      isActive?: boolean;
    },
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    this.requireAdmin(this.getSession(headers));
    return this.posService.updateItem(id, body);
  }

  @Delete('/items/:id')
  deleteItem(@Param('id') id: string, @Headers() headers: Record<string, string | string[] | undefined>) {
    this.requireAdmin(this.getSession(headers));
    return this.posService.deleteItem(id);
  }

  @Post('/stock/opening')
  stockOpening(
    @Body() body: { branchId: string; itemId: string; qty: number; costPrice?: number; reason?: string },
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    this.requireAdmin(this.getSession(headers));
    return this.posService.createStockOpening(body.branchId, body.itemId, body.qty, body.costPrice, body.reason);
  }

  @Patch('/stock/opening')
  updateStockOpening(
    @Body() body: { branchId: string; itemId: string; qty: number; costPrice?: number; reason?: string },
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    this.requireAdmin(this.getSession(headers));
    return this.posService.updateStockOpening(body.branchId, body.itemId, body.qty, body.costPrice, body.reason);
  }

  @Post('/stock/adjustment')
  stockAdjustment(
    @Body() body: { branchId: string; itemId: string; qty: number; direction: 'IN' | 'OUT'; costPrice?: number; reason: string },
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    this.requireAdmin(this.getSession(headers));
    return this.posService.createStockAdjustment(body.branchId, body.itemId, body.qty, body.direction, body.costPrice, body.reason);
  }

  @Get('/stock/on-hand')
  onHand(@Query('branchId') branchId: string, @Query('itemId') itemId?: string) {
    return this.posService.getOnHand(branchId, itemId);
  }

  @Get('/stock/ledger')
  stockLedger(@Query('branchId') branchId: string, @Query('itemId') itemId?: string) {
    return this.posService.getLedger(branchId, itemId);
  }

  @Post('/sales')
  createSale(
    @Body() body: { branchId: string; customerId: string; lines: Array<{ itemId: string; qty: number; rate: number; discountAmount?: number; taxRate: number }> },
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    return this.posService.createSale(this.getSession(headers), body);
  }

  @Post('/sales/:id/settle')
  @HttpCode(200)
  settleSale(
    @Param('id') id: string,
    @Body() body: { payments: Array<{ mode: PaymentMode; amount: number; reference?: string }> },
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    return this.posService.settleSale(this.getSession(headers), id, body.payments);
  }

  @Get('/sales')
  listSales(@Query('branchId') branchId: string) {
    return this.posService.listSales(branchId);
  }

  @Get('/sales/:id')
  getSaleById(@Param('id') id: string) {
    return this.posService.getSaleById(id);
  }

  @Post('/sales/:id/return')
  createReturn(
    @Param('id') id: string,
    @Body() body: { lines: Array<{ saleLineId: string; qty: number }>; refundMode: PaymentMode },
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    return this.posService.createReturn(this.getSession(headers), id, body);
  }

  @Get('/receipts/:id')
  getReceipt(@Param('id') id: string) {
    return this.posService.getReceiptById(id);
  }

  @Get('/receipts/by-invoice/:invoiceId')
  getReceiptsByInvoice(@Param('invoiceId') invoiceId: string) {
    return this.posService.getReceiptsByInvoice(invoiceId);
  }
}
