import { Module, OnModuleInit } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { SessionCookieInterceptor } from './auth/session-cookie';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { RecoveryService } from './auth/recovery.service';
import { InstanceStatusGuard } from './common/instance-status.guard';
import { MetaController } from './meta/meta.controller';
import { MetaService } from './meta/meta.service';
import { MigrationController } from './migration/migration.controller';
import { ExportService } from './migration/export.service';
import { SetupController } from './setup/setup.controller';
import { SetupService } from './setup/setup.service';
import { BranchesController } from './branches/branches.controller';
import { BranchesService } from './branches/branches.service';
import { AccessService } from './common/access.service';
import { CostVisibilityInterceptor } from './common/cost-visibility.interceptor';
import { AuditService } from './common/audit.service';
import { AuditController } from './audit/audit.controller';
import { CountersController } from './counters/counters.controller';
import { CountersService } from './counters/counters.service';
import { CustomersController } from './customers/customers.controller';
import { ExportsController } from './exports/exports.controller';
import { ExportsService } from './exports/exports.service';
import { CrashReportsController } from './crash/crash-reports.controller';
import { CrashReportsService } from './crash/crash-reports.service';
import { CustomersService } from './customers/customers.service';
import { ReceivablesService } from './customers/receivables.service';
import { GstController } from './gst/gst.controller';
import { GstService } from './gst/gst.service';
import { ItemsController } from './items/items.controller';
import { ItemsService } from './items/items.service';
import { createPrismaService, PrismaService } from './prisma.service';
import { AccountsController } from './accounts/accounts.controller';
import { BillingController } from './billing/billing.controller';
import { BillingReminders } from './billing/reminders';
import { BillingService } from './billing/billing.service';
import { AccountsService } from './accounts/accounts.service';
import { BusinessDeletionService } from './accounts/business-deletion.service';
import { Mailer } from './mail/mailer';
import { ReceiptEmailService } from './sales/receipt-email.service';
import { FallbackController } from './fallback/fallback.controller';
import { FallbackService } from './fallback/fallback.service';
import { FallbackOutboxController } from './fallback/outbox';
import { ProvisioningService } from './tenancy/provisioning.service';
import { ImportService } from './tenancy/import.service';
import { TenancyService } from './tenancy/tenancy.service';
import { TenantClients } from './tenancy/tenant-clients';
import { PurchasesController } from './purchases/purchases.controller';
import { PurchaseReturnsService } from './purchases/purchase-returns.service';
import { PurchasesService } from './purchases/purchases.service';
import { SuppliersController } from './suppliers/suppliers.controller';
import { ExpensesController } from './expenses/expenses.controller';
import { ItemGroupsController } from './items/item-groups.controller';
import { ItemGroupsService } from './items/item-groups.service';
import { ItemImportService } from './items/item-import.service';
import { ExpensesService } from './expenses/expenses.service';
import { SuppliersService } from './suppliers/suppliers.service';
import { RegistersController } from './registers/registers.controller';
import { RegistersService } from './registers/registers.service';
import { ReportsController } from './reports/reports.controller';
import { ReportsService } from './reports/reports.service';
import { ReturnsController } from './returns/returns.controller';
import { ReturnsService } from './returns/returns.service';
import { SalesController } from './sales/sales.controller';
import { SalesService } from './sales/sales.service';
import { SaleSettlementService } from './sales/sale-settlement.service';
import { SequenceService } from './sequences/sequences.service';
import { SettingsController } from './settings/settings.controller';
import { SettingsService } from './settings/settings.service';
import { StockController } from './stock/stock.controller';
import { StockService } from './stock/stock.service';
import { TransfersController } from './transfers/transfers.controller';
import { TransfersService } from './transfers/transfers.service';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';

@Module({
  controllers: [
    AuditController,
    FallbackController,
    FallbackOutboxController,
    MetaController,
    SetupController,
    AccountsController,
    BillingController,
    AuthController,
    BranchesController,
    SettingsController,
    RegistersController,
    CountersController,
    UsersController,
    CustomersController,
    ExportsController,
    CrashReportsController,
    ItemsController,
    StockController,
    PurchasesController,
    SuppliersController,
    ExpensesController,
    ItemGroupsController,
    TransfersController,
    SalesController,
    ReturnsController,
    ReportsController,
    GstController,
    MigrationController
  ],
  providers: [
    // Offline: the local database. Online: the current request's business (see prisma.service.ts).
    { provide: PrismaService, useFactory: createPrismaService },
    TenantClients,
    AuditService,
    TenancyService,
    ProvisioningService,
    ImportService,
    AccountsService,
    BusinessDeletionService,
    BillingService,
    BillingReminders,
    Mailer,
    ReceiptEmailService,
    FallbackService,
    SettingsService,
    SequenceService,
    ItemsService,
    StockService,
    PurchasesService,
    PurchaseReturnsService,
    SuppliersService,
    ExpensesService,
    ItemGroupsService,
    ItemImportService,
    TransfersService,
    CustomersService,
    ExportsService,
    CrashReportsService,
    ReceivablesService,
    BranchesService,
    AccessService,
    UsersService,
    AuthService,
    RecoveryService,
    CountersService,
    RegistersService,
    SalesService,
    SaleSettlementService,
    ReturnsService,
    ReportsService,
    GstService,
    MetaService,
    SetupService,
    ExportService,
    // Guards run in this order: who is calling, then whether this install accepts changes.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: InstanceStatusGuard },
    { provide: APP_INTERCEPTOR, useClass: SessionCookieInterceptor },
    { provide: APP_INTERCEPTOR, useClass: CostVisibilityInterceptor }
  ]
})
export class AppModule implements OnModuleInit {
  constructor(private readonly auth: AuthService) {}

  async onModuleInit() {
    await this.auth.onModuleInitSeed();
  }
}
