import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CustomerScope, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { toNumber } from '../common/numbers';
import { businessSettingsSelect, branchSettingsSelect } from '../common/selects';

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService
  ) {}

  async ensureBranchExists(branchId: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    const branch = await client.branch.findUnique({ where: { id: branchId }, select: { id: true } });
    if (!branch) {
      throw new BadRequestException(`Invalid branchId: ${branchId}`);
    }
  }

  async ensureBusinessSettings(tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    return client.businessSettings.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default', name: 'My Business' },
      select: businessSettingsSelect
    });
  }

  private toBusinessSettingsResponse(settings: Awaited<ReturnType<SettingsService['ensureBusinessSettings']>>) {
    return { ...settings, cashierMaxDiscountPercent: toNumber(settings.cashierMaxDiscountPercent) };
  }

  async getBusinessSettings() {
    return this.toBusinessSettingsResponse(await this.ensureBusinessSettings());
  }

  async updateBusinessSettings(input: {
    name?: string;
    logoUrl?: string | null;
    gstNumber?: string | null;
    taxCalculationMode?: 'AFTER_DISCOUNT' | 'BEFORE_DISCOUNT';
    cashierMaxDiscountPercent?: number;
    customerScope?: CustomerScope;
    timezone?: string;
  }) {
    await this.ensureBusinessSettings();
    const updated = await this.prisma.businessSettings.update({
      where: { id: 'default' },
      data: {
        name: input.name,
        logoUrl: input.logoUrl,
        gstNumber: input.gstNumber,
        taxCalculationMode: input.taxCalculationMode,
        cashierMaxDiscountPercent: input.cashierMaxDiscountPercent,
        customerScope: input.customerScope,
        timezone: input.timezone
      },
      select: businessSettingsSelect
    });
    return this.toBusinessSettingsResponse(updated);
  }

  async getBranchSettings(branchId: string) {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: branchSettingsSelect
    });
    if (!branch) {
      throw new NotFoundException('Branch not found');
    }
    return branch;
  }

  async updateBranchSettings(
    branchId: string,
    input: {
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
    }
  ) {
    await this.ensureBranchExists(branchId);
    return this.prisma.branch.update({
      where: { id: branchId },
      data: {
        name: input.name,
        code: input.code,
        logoUrl: input.logoUrl,
        invoicePrefix: input.invoicePrefix,
        receiptPrefix: input.receiptPrefix,
        returnPrefix: input.returnPrefix,
        invoiceHeader: input.invoiceHeader,
        invoiceFooter: input.invoiceFooter,
        receiptHeader: input.receiptHeader,
        receiptFooter: input.receiptFooter,
        invoiceCss: input.invoiceCss,
        receiptCss: input.receiptCss
      },
      select: branchSettingsSelect
    });
  }

  async getCustomerScope(tx?: Prisma.TransactionClient) {
    return (await this.ensureBusinessSettings(tx)).customerScope;
  }
}
