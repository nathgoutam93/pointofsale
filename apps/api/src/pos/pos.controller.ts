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

  @Get('/branches/:id')
  getBranch(@Param('id') id: string, @Headers() headers: Record<string, string | string[] | undefined>) {
    const session = this.getSession(headers);
    if (session.branchId !== id) {
      throw new BadRequestException('Branch mismatch');
    }
    return this.posService.getBranchSettings(id);
  }

  @Patch('/branches/:id')
  updateBranch(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      code?: string;
      logoUrl?: string | null;
      invoicePrefix?: string;
      receiptPrefix?: string;
      returnPrefix?: string;
      invoiceHeader?: string | null;
      invoiceFooter?: string | null;
      receiptHeader?: string | null;
      receiptFooter?: string | null;
      invoiceCss?: string | null;
      receiptCss?: string | null;
    },
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    const session = this.getSession(headers);
    this.requireAdmin(session);
    if (session.branchId !== id) {
      throw new BadRequestException('Branch mismatch');
    }
    return this.posService.updateBranchSettings(id, body);
  }

  @Post('/branches/:id/logo')
  @UseInterceptors(
    FileInterceptor('file', {
      dest: join(process.cwd(), 'uploads', 'branches'),
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
    @Param('id') id: string,
    @UploadedFile() file: { filename: string } | undefined,
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    const session = this.getSession(headers);
    this.requireAdmin(session);
    if (session.branchId !== id) {
      throw new BadRequestException('Branch mismatch');
    }
    if (!file) {
      throw new BadRequestException('Image file is required');
    }
    return this.posService.updateBranchSettings(id, { logoUrl: `/uploads/branches/${file.filename}` });
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

  @Get('/users')
  listUsers(@Query('branchId') branchId: string, @Headers() headers: Record<string, string | string[] | undefined>) {
    const session = this.getSession(headers);
    this.requireAdmin(session);
    if (session.branchId !== branchId) {
      throw new BadRequestException('Branch mismatch');
    }
    return this.posService.listUsers(branchId);
  }

  @Post('/users')
  createUser(
    @Body() body: { branchId: string; username: string; password: string },
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    const session = this.getSession(headers);
    this.requireAdmin(session);
    if (session.branchId !== body.branchId) {
      throw new BadRequestException('Branch mismatch');
    }
    return this.posService.createUser(body.branchId, body);
  }

  @Patch('/users/:id')
  updateUser(
    @Param('id') id: string,
    @Body() body: { username?: string; password?: string; isActive?: boolean },
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    const session = this.getSession(headers);
    this.requireAdmin(session);
    return this.posService.updateUser(session, id, body);
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

  @Get('/reports/sales-summary')
  salesSummary(@Query('branchId') branchId: string, @Headers() headers: Record<string, string | string[] | undefined>) {
    const session = this.getSession(headers);
    this.requireAdmin(session);
    return this.posService.getSalesSummary(session, branchId);
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
