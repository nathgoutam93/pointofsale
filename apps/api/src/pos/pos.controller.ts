import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Headers,
  Param,
  ParseUUIDPipe,
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
import { appContract } from '@pos/contracts';
import { Public } from '../auth/auth.guard';
import { readBearerToken, verifyToken } from '../auth/token';
import { ZodValidationPipe } from '../validation/zod-validation.pipe';

const uploadsDir = process.env.UPLOADS_DIR ? process.env.UPLOADS_DIR : join(process.cwd(), 'uploads');

@Controller()
export class PosController {
  constructor(private readonly posService: PosService) {}

  // AuthGuard has already verified the token and re-checked it against the database.
  private getSession(headers: Record<string, string | string[] | undefined>): SessionUser {
    const token = readBearerToken(headers);
    const session = token ? verifyToken(token) : null;
    if (!session) {
      throw new UnauthorizedException('Invalid bearer token');
    }
    return session;
  }

  private requireBranchSession(headers: Record<string, string | string[] | undefined>) {
    const session = this.getSession(headers);
    if (!session.branchId) {
      throw new BadRequestException('Select a branch and open a register first');
    }
    return session;
  }

  private requireOpenRegisterSession(headers: Record<string, string | string[] | undefined>) {
    const session = this.requireBranchSession(headers);
    if (!session.registerId) {
      throw new BadRequestException('Register is not open');
    }
    return session;
  }

  private requireAdminSession(headers: Record<string, string | string[] | undefined>) {
    const session = this.getSession(headers);
    this.requireAdmin(session);
    return session;
  }

  private requireAdmin(session: SessionUser) {
    if (session.role !== UserRole.ADMIN) {
      throw new BadRequestException('Admin role required');
    }
  }

  @Public()
  @Post('/auth/login')
  @HttpCode(200)
  login(@Body(new ZodValidationPipe(appContract.auth.login.body)) body: { username: string; password: string }) {
    return this.posService.login(body.username, body.password);
  }

  @Get('/auth/me')
  me(@Headers() headers: Record<string, string | string[] | undefined>) {
    return this.posService.me(this.getSession(headers));
  }

  @Get('/branches')
  listAccessibleBranches(@Headers() headers: Record<string, string | string[] | undefined>) {
    return this.posService.listAccessibleBranches(this.getSession(headers));
  }

  @Post('/branches')
  createBranch(
    @Body(new ZodValidationPipe(appContract.branches.create.body)) body: { name: string; code: string },
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    const session = this.requireAdminSession(headers);
    return this.posService.createBranch(session, body);
  }

  @Post('/registers/open')
  @HttpCode(200)
  openRegister(
    @Body(new ZodValidationPipe(appContract.registers.open.body)) body: { branchId: string; openingBalance: number },
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    return this.posService.openRegister(this.getSession(headers), body.branchId, body.openingBalance);
  }

  @Get('/registers/current')
  currentRegister(@Headers() headers: Record<string, string | string[] | undefined>) {
    return this.posService.getCurrentRegister(this.getSession(headers));
  }

  @Get('/registers/summary')
  registerSummary(@Headers() headers: Record<string, string | string[] | undefined>) {
    return this.posService.getRegisterSummaries(this.getSession(headers));
  }

  @Post('/registers/close')
  @HttpCode(200)
  closeRegister(
    @Body(new ZodValidationPipe(appContract.registers.close.body)) body: { closingBalance: number },
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    return this.posService.closeRegister(this.requireOpenRegisterSession(headers), body.closingBalance);
  }

  @Get('/business/settings')
  getBusinessSettings(@Headers() headers: Record<string, string | string[] | undefined>) {
    this.getSession(headers);
    return this.posService.getBusinessSettings();
  }

  @Patch('/business/settings')
  updateBusinessSettings(
    @Body(new ZodValidationPipe(appContract.business.update.body))
    body: {
      name?: string;
      logoUrl?: string | null;
      gstNumber?: string | null;
      taxCalculationMode?: 'AFTER_DISCOUNT' | 'BEFORE_DISCOUNT';
    },
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    this.requireAdmin(this.getSession(headers));
    return this.posService.updateBusinessSettings(body);
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
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    this.requireAdmin(this.getSession(headers));
    if (!file) {
      throw new BadRequestException('Image file is required');
    }
    return this.posService.updateBusinessSettings({ logoUrl: `/uploads/business/${file.filename}` });
  }

  @Get('/branches/:id')
  getBranch(@Param('id', ParseUUIDPipe) id: string, @Headers() headers: Record<string, string | string[] | undefined>) {
    const session = this.getSession(headers);
    if (session.branchId && session.branchId !== id) {
      throw new BadRequestException('Branch mismatch');
    }
    return this.posService.getBranchSettings(id);
  }

  @Patch('/branches/:id')
  updateBranch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(appContract.branches.update.body))
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
    const session = this.requireAdminSession(headers);
    if (session.branchId && session.branchId !== id) {
      throw new BadRequestException('Branch mismatch');
    }
    return this.posService.updateBranchSettings(id, body);
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
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    const session = this.requireAdminSession(headers);
    if (session.branchId && session.branchId !== id) {
      throw new BadRequestException('Branch mismatch');
    }
    if (!file) {
      throw new BadRequestException('Image file is required');
    }
    return this.posService.updateBranchSettings(id, { logoUrl: `/uploads/branches/${file.filename}` });
  }

  @Get('/customers')
  listCustomers(
    @Query(new ZodValidationPipe(appContract.customers.list.query)) { branchId }: { branchId: string },
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    const session = this.requireOpenRegisterSession(headers);
    if (session.branchId !== branchId) {
      throw new BadRequestException('Branch mismatch');
    }
    return this.posService.listCustomers(branchId);
  }

  @Post('/customers')
  createCustomer(
    @Body(new ZodValidationPipe(appContract.customers.create.body)) body: { branchId: string; name: string; phone?: string },
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    const session = this.requireOpenRegisterSession(headers);
    if (session.branchId !== body.branchId) {
      throw new BadRequestException('Branch mismatch');
    }
    return this.posService.createCustomer(body.branchId, body.name, body.phone);
  }

  @Patch('/customers/:id')
  updateCustomer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(appContract.customers.update.body)) body: { name?: string; phone?: string | null },
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    const session = this.requireOpenRegisterSession(headers);
    if (!session.branchId) {
      throw new BadRequestException('Branch mismatch');
    }
    return this.posService.updateCustomer(session.branchId, id, body);
  }

  @Get('/customers/walk-in/:branchId')
  getWalkIn(@Param('branchId', ParseUUIDPipe) branchId: string, @Headers() headers: Record<string, string | string[] | undefined>) {
    const session = this.requireOpenRegisterSession(headers);
    if (session.branchId !== branchId) {
      throw new BadRequestException('Branch mismatch');
    }
    return this.posService.getWalkIn(branchId);
  }

  @Get('/customers/:id/wallet')
  getWallet(@Param('id', ParseUUIDPipe) customerId: string, @Headers() headers: Record<string, string | string[] | undefined>) {
    const session = this.requireOpenRegisterSession(headers);
    return this.posService.getWallet(session.branchId!, customerId);
  }

  @Post('/customers/:id/wallet/topup')
  @HttpCode(200)
  topupWallet(
    @Param('id', ParseUUIDPipe) customerId: string,
    @Body(new ZodValidationPipe(appContract.customers.topupWallet.body)) body: { amount: number; reference?: string },
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    const session = this.requireOpenRegisterSession(headers);
    this.requireAdmin(session);
    return this.posService.topupWallet(session.branchId!, customerId, body.amount, body.reference);
  }

  @Get('/users')
  listUsers(
    @Query(new ZodValidationPipe(appContract.users.list.query)) { branchId }: { branchId: string },
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    const session = this.requireAdminSession(headers);
    if (session.branchId && session.branchId !== branchId) {
      throw new BadRequestException('Branch mismatch');
    }
    return this.posService.listUsers(branchId);
  }

  @Post('/users')
  createUser(
    @Body(new ZodValidationPipe(appContract.users.create.body)) body: { branchId: string; username: string; password: string; branchIds?: string[] },
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    const session = this.requireAdminSession(headers);
    if (session.branchId && session.branchId !== body.branchId) {
      throw new BadRequestException('Branch mismatch');
    }
    return this.posService.createUser(body.branchId, body);
  }

  @Patch('/users/:id')
  updateUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(appContract.users.update.body)) body: { username?: string; password?: string; isActive?: boolean },
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    const session = this.requireAdminSession(headers);
    return this.posService.updateUser(session, id, body);
  }

  @Post('/users/:id/branches/:branchId')
  @HttpCode(204)
  addUserBranchAccess(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    const session = this.requireAdminSession(headers);
    return this.posService.grantUserBranchAccess(session, id, branchId);
  }

  @Delete('/users/:id/branches/:branchId')
  @HttpCode(204)
  removeUserBranchAccess(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    const session = this.requireAdminSession(headers);
    return this.posService.revokeUserBranchAccess(session, id, branchId);
  }

  @Get('/items')
  listItems(
    @Query(new ZodValidationPipe(appContract.items.list.query)) { activeOnly }: { activeOnly?: boolean },
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    this.getSession(headers);
    return this.posService.listItems(activeOnly === true);
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
  uploadItemImage(@UploadedFile() file: { filename: string } | undefined, @Headers() headers: Record<string, string | string[] | undefined>) {
    this.requireAdminSession(headers);
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
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    this.requireAdminSession(headers);
    return this.posService.createItem(body);
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
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    this.requireAdminSession(headers);
    return this.posService.updateItem(id, body);
  }

  @Delete('/items/:id')
  deleteItem(@Param('id', ParseUUIDPipe) id: string, @Headers() headers: Record<string, string | string[] | undefined>) {
    this.requireAdminSession(headers);
    return this.posService.deleteItem(id);
  }

  @Post('/stock/opening')
  stockOpening(
    @Body(new ZodValidationPipe(appContract.stock.opening.body)) body: { branchId: string; itemId: string; qty: number; costPrice?: number; reason?: string },
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    const session = this.requireOpenRegisterSession(headers);
    this.requireAdmin(session);
    if (session.branchId !== body.branchId) {
      throw new BadRequestException('Branch mismatch');
    }
    return this.posService.createStockOpening(body.branchId, body.itemId, body.qty, body.costPrice, body.reason);
  }

  @Patch('/stock/opening')
  updateStockOpening(
    @Body(new ZodValidationPipe(appContract.stock.updateOpening.body)) body: { branchId: string; itemId: string; qty: number; costPrice?: number; reason?: string },
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    const session = this.requireOpenRegisterSession(headers);
    this.requireAdmin(session);
    if (session.branchId !== body.branchId) {
      throw new BadRequestException('Branch mismatch');
    }
    return this.posService.updateStockOpening(body.branchId, body.itemId, body.qty, body.costPrice, body.reason);
  }

  @Post('/stock/adjustment')
  stockAdjustment(
    @Body(new ZodValidationPipe(appContract.stock.adjustment.body)) body: { branchId: string; itemId: string; qty: number; direction: 'IN' | 'OUT'; costPrice?: number; reason: string },
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    const session = this.requireOpenRegisterSession(headers);
    this.requireAdmin(session);
    if (session.branchId !== body.branchId) {
      throw new BadRequestException('Branch mismatch');
    }
    return this.posService.createStockAdjustment(body.branchId, body.itemId, body.qty, body.direction, body.costPrice, body.reason);
  }

  @Get('/stock/on-hand')
  onHand(
    @Query(new ZodValidationPipe(appContract.stock.onHand.query)) { branchId, itemId }: { branchId: string; itemId?: string },
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    const session = this.requireOpenRegisterSession(headers);
    if (session.branchId !== branchId) {
      throw new BadRequestException('Branch mismatch');
    }
    return this.posService.getOnHand(branchId, itemId);
  }

  @Get('/stock/ledger')
  stockLedger(
    @Query(new ZodValidationPipe(appContract.stock.ledger.query)) { branchId, itemId }: { branchId: string; itemId?: string },
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    const session = this.requireOpenRegisterSession(headers);
    if (session.branchId !== branchId) {
      throw new BadRequestException('Branch mismatch');
    }
    return this.posService.getLedger(branchId, itemId);
  }

  @Get('/reports/sales-summary')
  salesSummary(
    @Query(new ZodValidationPipe(appContract.reports.salesSummary.query)) { branchId }: { branchId: string },
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    const session = this.requireAdminSession(headers);
    return this.posService.getSalesSummary(session, branchId);
  }

  @Post('/sales')
  createSale(
    @Body(new ZodValidationPipe(appContract.sales.create.body))
    body: {
      branchId: string;
      customerId: string;
      walkInCustomerName?: string | null;
      walkInCustomerPhone?: string | null;
      lines: Array<{
        itemId: string;
        qty: number;
        rate: number;
        saleUom?: string;
        saleUomQty?: number;
        saleUomConversionQty?: number;
        taxRate: number;
        taxMode?: 'INCLUSIVE' | 'EXCLUSIVE';
        discounts?: Array<{ type: 'PERCENTAGE' | 'FIXED'; value: number }>;
      }>;
      discounts?: Array<{ type: 'PERCENTAGE' | 'FIXED'; value: number }>;
    },
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    return this.posService.createSale(this.requireOpenRegisterSession(headers), body);
  }

  @Post('/sales/:id/settle')
  @HttpCode(200)
  settleSale(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(appContract.sales.settle.body)) body: { payments: Array<{ mode: PaymentMode; amount: number; reference?: string }> },
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    return this.posService.settleSale(this.requireOpenRegisterSession(headers), id, body.payments);
  }

  @Get('/sales')
  listSales(
    @Query(new ZodValidationPipe(appContract.sales.list.query)) { branchId }: { branchId: string },
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    const session = this.requireOpenRegisterSession(headers);
    if (session.branchId !== branchId) {
      throw new BadRequestException('Branch mismatch');
    }
    return this.posService.listSales(branchId);
  }

  @Get('/sales/:id')
  getSaleById(@Param('id', ParseUUIDPipe) id: string, @Headers() headers: Record<string, string | string[] | undefined>) {
    const session = this.requireOpenRegisterSession(headers);
    return this.posService.getSaleById(session.branchId!, id);
  }

  @Post('/sales/:id/return')
  createReturn(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(appContract.sales.returns.body)) body: { lines: Array<{ saleLineId: string; qty: number }>; refundMode: 'CASH' | 'WALLET' },
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    return this.posService.createReturn(this.requireOpenRegisterSession(headers), id, body);
  }

  @Get('/receipts/:id')
  getReceipt(@Param('id', ParseUUIDPipe) id: string, @Headers() headers: Record<string, string | string[] | undefined>) {
    const session = this.requireOpenRegisterSession(headers);
    return this.posService.getReceiptById(session.branchId!, id);
  }

  @Get('/receipts/by-invoice/:invoiceId')
  getReceiptsByInvoice(@Param('invoiceId') invoiceId: string, @Headers() headers: Record<string, string | string[] | undefined>) {
    const session = this.requireOpenRegisterSession(headers);
    return this.posService.getReceiptsByInvoice(session.branchId!, invoiceId);
  }

  @Get('/returns')
  listReturns(@Headers() headers: Record<string, string | string[] | undefined>) {
    const session = this.requireOpenRegisterSession(headers);
    return this.posService.listReturns(session.branchId!);
  }

  @Get('/returns/:id')
  getReturnById(@Param('id', ParseUUIDPipe) id: string, @Headers() headers: Record<string, string | string[] | undefined>) {
    return this.posService.getReturnById(this.requireOpenRegisterSession(headers), id);
  }
}
