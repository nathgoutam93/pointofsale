import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CompositionCategory, CustomerScope, Prisma, TaxpayerType } from '@prisma/client';
import { COMPOSITION_CATEGORY_LABELS } from '@pos/contracts';
import { PrismaService } from '../prisma.service';
import { toNumber } from '../common/numbers';
import { businessSettingsSelect, branchSettingsSelect } from '../common/selects';
import type { SessionUser } from '../common/types';
import { localDate, startOfLocalDay } from '../reports/zoned-dates';

export type TaxpayerTypeInForce = {
  taxpayerType: TaxpayerType;
  compositionCategory: CompositionCategory | null;
  /** When it took effect; null while the business has never changed type (REGULAR). */
  effectiveDate: string | null;
};

const describeType = (type: TaxpayerType, category: CompositionCategory | null) =>
  type === 'COMPOSITION' && category ? `composition (${COMPOSITION_CATEGORY_LABELS[category].toLowerCase()})` : 'regular';

const formatDate = (date: { year: number; month: number; day: number }) =>
  `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;

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

  private async toBusinessSettingsResponse(settings: Awaited<ReturnType<SettingsService['ensureBusinessSettings']>>) {
    const { taxpayerType, compositionCategory } = await this.taxpayerTypeAt(new Date());
    return {
      ...settings,
      cashierMaxDiscountPercent: toNumber(settings.cashierMaxDiscountPercent),
      taxpayerType,
      compositionCategory
    };
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
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('taxpayer-type-change'))`;
      const settings = await tx.businessSettings.update({
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
      // A scheduled taxpayer type change starts at midnight on its date in the business
      // time zone, so it moves with the zone.
      const now = new Date();
      const scheduled = await tx.taxpayerTypeChange.findMany({ where: { effectiveFrom: { gt: now } } });
      for (const change of scheduled) {
        const [year, month, day] = change.effectiveDate.split('-').map(Number);
        const effectiveFrom = startOfLocalDay(year, month, day, settings.timezone);
        await tx.taxpayerTypeChange.update({
          where: { id: change.id },
          data: { effectiveFrom: effectiveFrom > now ? effectiveFrom : now }
        });
      }
      return settings;
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

  /** The GST registration type in force at `at`: the latest change at or before it. */
  async taxpayerTypeAt(at: Date, tx?: Prisma.TransactionClient): Promise<TaxpayerTypeInForce> {
    const client = tx ?? this.prisma;
    const change = await client.taxpayerTypeChange.findFirst({
      where: { effectiveFrom: { lte: at } },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }]
    });
    return change
      ? { taxpayerType: change.taxpayerType, compositionCategory: change.compositionCategory, effectiveDate: change.effectiveDate }
      : { taxpayerType: 'REGULAR', compositionCategory: null, effectiveDate: null };
  }

  async getTaxpayerTypeSummary(tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    const now = new Date();
    const history = await client.taxpayerTypeChange.findMany({
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        taxpayerType: true,
        compositionCategory: true,
        effectiveDate: true,
        effectiveFrom: true,
        createdByName: true,
        createdAt: true
      }
    });
    return {
      current: await this.taxpayerTypeAt(now, tx),
      scheduled: history.find((change) => change.effectiveFrom > now) ?? null,
      history
    };
  }

  /**
   * Records a change of GST registration type from `effectiveDate` (today or later in the
   * business time zone; never backdated, since invoices already made keep their type).
   * Only one change can be waiting at a time. A change for today takes effect immediately.
   */
  async changeTaxpayerType(
    session: SessionUser,
    input: { taxpayerType: TaxpayerType; compositionCategory?: CompositionCategory | null; effectiveDate: string }
  ) {
    const compositionCategory = input.taxpayerType === 'COMPOSITION' ? input.compositionCategory ?? null : null;
    if (input.taxpayerType === 'COMPOSITION' && !compositionCategory) {
      throw new BadRequestException('Choose the composition category; it sets the rate');
    }
    return this.prisma.$transaction(async (tx) => {
      // One change at a time, so two admins can't both schedule one.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('taxpayer-type-change'))`;
      const { timezone } = await this.ensureBusinessSettings(tx);
      const now = new Date();
      const today = formatDate(localDate(now, timezone));
      if (input.effectiveDate < today) {
        throw new BadRequestException(
          `The change can't start before today (${today}); sales already made keep the type they were made under`
        );
      }

      const scheduled = await tx.taxpayerTypeChange.findFirst({ where: { effectiveFrom: { gt: now } } });
      if (scheduled) {
        throw new BadRequestException(
          `A change to ${describeType(scheduled.taxpayerType, scheduled.compositionCategory)} from ${scheduled.effectiveDate} is already scheduled; cancel it first`
        );
      }
      const current = await this.taxpayerTypeAt(now, tx);
      if (current.taxpayerType === input.taxpayerType && current.compositionCategory === compositionCategory) {
        throw new BadRequestException(`The business is already ${describeType(current.taxpayerType, current.compositionCategory)}`);
      }

      const [year, month, day] = input.effectiveDate.split('-').map(Number);
      const user = await tx.user.findUnique({ where: { id: session.userId }, select: { username: true } });
      if (!user) {
        throw new NotFoundException('User not found');
      }
      await tx.taxpayerTypeChange.create({
        data: {
          taxpayerType: input.taxpayerType,
          compositionCategory,
          effectiveDate: input.effectiveDate,
          // A change for today starts now; sales earlier today were made under the old type.
          effectiveFrom: input.effectiveDate === today ? now : startOfLocalDay(year, month, day, timezone),
          createdBy: session.userId,
          createdByName: user.username
        }
      });
      return this.getTaxpayerTypeSummary(tx);
    });
  }

  /** Cancels a change that hasn't taken effect yet. One already in force can only be followed by another change. */
  async cancelTaxpayerTypeChange(id: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('taxpayer-type-change'))`;
      const change = await tx.taxpayerTypeChange.findUnique({ where: { id } });
      if (!change) {
        throw new NotFoundException('Taxpayer type change not found');
      }
      if (change.effectiveFrom <= new Date()) {
        throw new BadRequestException('This change is already in force; schedule another change instead');
      }
      await tx.taxpayerTypeChange.delete({ where: { id } });
      return this.getTaxpayerTypeSummary(tx);
    });
  }
}
