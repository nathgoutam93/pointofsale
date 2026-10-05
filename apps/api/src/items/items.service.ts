import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { chargesGst, defaultSupplyType, hsnProblem, mrpProblem, suggestUqc, supplyTypeProblem, type GstSupplyType } from '@pos/contracts';
import { PrismaService } from '../prisma.service';
import { SettingsService } from '../settings/settings.service';
import { BranchesService } from '../branches/branches.service';
import type { ItemSaleUomInput, SessionUser } from '../common/types';
import { requireAdmin } from '../common/request-session';
import { withBranchPrices } from '../common/branch-prices';
import { toNumber, round2 } from '../common/numbers';
import { normalizeLeastCount } from '../common/quantities';
import { AuditService } from '../common/audit.service';

/** An item as the API answers it: its sale units in order and its barcodes. */
const itemInclude = {
  saleUoms: { orderBy: { sortOrder: 'asc' } },
  barcodes: { orderBy: { createdAt: 'asc' }, select: { id: true, barcode: true, saleUom: true } }
} satisfies Prisma.ItemInclude;

type ItemBarcodeInput = { barcode: string; saleUom?: string | null };

/** The item fields the audit log follows. */
const AUDITED_ITEM_FIELDS = ['name', 'code', 'category', 'uom', 'costPrice', 'sellPrice', 'mrp', 'taxMode', 'taxRate', 'hsnCode', 'supplyType', 'isActive', 'tracksBatches'];

@Injectable()
export class ItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly branches: BranchesService,
    private readonly audit: AuditService
  ) {}

  /** Rejects an HSN code shorter than the business requires (the format is checked by the contract). */
  private async assertHsnCode(hsnCode: string | null | undefined, tx?: Prisma.TransactionClient) {
    if (!hsnCode) return;
    const { hsnMinDigits } = await this.settings.ensureBusinessSettings(tx);
    const problem = hsnProblem(hsnCode, hsnMinDigits);
    if (problem) throw new BadRequestException(`hsnCode: ${problem}`);
  }

  private assertSupplyType(supplyType: GstSupplyType, taxRate: number) {
    const problem = supplyTypeProblem(supplyType, taxRate);
    if (problem) throw new BadRequestException(problem);
  }

  async resolveItemId(itemRef: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    const item = await client.item.findFirst({
      where: {
        OR: [{ id: itemRef }, { code: itemRef }]
      },
      select: { id: true }
    });

    if (!item) {
      throw new BadRequestException(`Invalid itemId/item code: ${itemRef}`);
    }

    return item.id;
  }

  /**
   * Goods may never be sold above their MRP (Legal Metrology rules), which includes GST: a
   * tax-exclusive price is checked with GST added while the business charges it. An MRP of 0
   * means none is printed.
   */
  private async assertWithinMrp(
    units: Array<{ uom: string; sellPrice: number; mrp: number }>,
    tax: { taxMode: 'INCLUSIVE' | 'EXCLUSIVE'; taxRate: number },
    tx?: Prisma.TransactionClient
  ) {
    const { taxpayerType } = await this.settings.taxpayerTypeAt(new Date(), tx);
    for (const unit of units) {
      const problem = mrpProblem(unit.sellPrice, unit.mrp, tax.taxMode, tax.taxRate, chargesGst(taxpayerType));
      if (problem) throw new BadRequestException(`The price per ${unit.uom} can't be above its MRP: ${problem}`);
    }
  }

  private normalizeItemSaleUoms(input: {
    uom: string;
    sellPrice: number;
    mrp?: number;
    saleUoms?: ItemSaleUomInput[];
  }) {
    const baseUom = input.uom.trim();
    if (!baseUom) {
      throw new BadRequestException('UOM is required');
    }

    const normalized = [
      {
        uom: baseUom,
        conversionQty: 1,
        sellPrice: round2(input.sellPrice),
        // No MRP given: none printed (0), so there is nothing to check it against.
        mrp: round2(input.mrp ?? 0),
        isDefault: true,
        sortOrder: 0
      }
    ];
    const seen = new Set([baseUom.toLowerCase()]);

    for (const variant of input.saleUoms ?? []) {
      const uom = variant.uom.trim();
      if (!uom || seen.has(uom.toLowerCase())) continue;
      const conversionQty = normalizeLeastCount(variant.conversionQty);
      normalized.push({
        uom,
        conversionQty,
        sellPrice: round2(variant.sellPrice),
        mrp: round2(variant.mrp ?? 0),
        isDefault: false,
        sortOrder: normalized.length
      });
      seen.add(uom.toLowerCase());
    }
    return normalized;
  }

  /** With a branch, each item carries that branch's prices (see withBranchPrices). */
  async listItems(session: SessionUser, activeOnly?: boolean, branchId?: string) {
    if (branchId) {
      await this.settings.ensureBranchExists(branchId);
      await this.branches.ensureUserHasBranchAccess(session.userId, branchId);
    }
    const items = await this.prisma.item.findMany({
      where: activeOnly ? { isActive: true } : undefined,
      include: itemInclude,
      orderBy: { createdAt: 'desc' }
    });
    if (!branchId) return items;

    const prices = await this.prisma.itemBranchPrice.findMany({ where: { branchId } });
    const pricesByItem = new Map<string, typeof prices>();
    for (const price of prices) {
      pricesByItem.set(price.itemId, [...(pricesByItem.get(price.itemId) ?? []), price]);
    }
    return items.map((item) => withBranchPrices(item, pricesByItem.get(item.id) ?? []));
  }

  /** A branch's own prices for an item, for pricing a sale line. */
  async branchPricesFor(tx: Prisma.TransactionClient, branchId: string, itemId: string) {
    return tx.itemBranchPrice.findMany({ where: { branchId, itemId }, select: { uom: true, sellPrice: true, mrp: true } });
  }

  async listBranchPrices(session: SessionUser, itemId: string) {
    requireAdmin(session);
    const item = await this.prisma.item.findUnique({ where: { id: itemId }, select: { id: true } });
    if (!item) throw new NotFoundException('Item not found');
    const branchIds = (await this.branches.listAccessibleBranches(session)).map((branch) => branch.id);
    return this.prisma.itemBranchPrice.findMany({
      where: { itemId, branchId: { in: branchIds } },
      orderBy: [{ branchId: 'asc' }, { uom: 'asc' }]
    });
  }

  /**
   * Replaces a branch's own prices for an item. Each unit must be one the item is sold in;
   * an MRP left out is the item's MRP for that unit. An empty list clears them.
   */
  async setBranchPrices(
    session: SessionUser,
    itemId: string,
    branchId: string,
    prices: Array<{ uom: string; sellPrice: number; mrp?: number }>
  ) {
    requireAdmin(session);
    await this.settings.ensureBranchExists(branchId);
    await this.branches.ensureUserHasBranchAccess(session.userId, branchId);
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.item.findUnique({
        where: { id: itemId },
        select: { uom: true, mrp: true, taxMode: true, taxRate: true, saleUoms: { select: { uom: true, mrp: true } } }
      });
      if (!item) throw new NotFoundException('Item not found');
      const units = [{ uom: item.uom, mrp: item.mrp }, ...item.saleUoms];

      const rows = prices.map((price) => {
        const unit = units.find((entry) => entry.uom.toLowerCase() === price.uom.trim().toLowerCase());
        if (!unit) throw new BadRequestException(`This item is not sold in ${price.uom}`);
        return {
          branchId,
          itemId,
          uom: unit.uom,
          sellPrice: round2(price.sellPrice),
          mrp: round2(price.mrp ?? toNumber(unit.mrp))
        };
      });
      await this.assertWithinMrp(rows, { taxMode: item.taxMode, taxRate: toNumber(item.taxRate) }, tx);
      const previous = await tx.itemBranchPrice.findMany({ where: { branchId, itemId }, select: { uom: true, sellPrice: true, mrp: true } });
      await tx.itemBranchPrice.deleteMany({ where: { branchId, itemId } });
      await tx.itemBranchPrice.createMany({ data: rows });
      await this.audit.record(
        session,
        {
          action: 'ITEM_PRICE_CHANGED',
          entityType: 'Item',
          entityId: itemId,
          branchId,
          summary: rows.length ? `Set the branch's own prices: ${rows.map((row) => `${row.uom} ${row.sellPrice.toFixed(2)}`).join(', ')}` : "Cleared the branch's own prices",
          details: { before: previous.map((row) => ({ uom: row.uom, sellPrice: Number(row.sellPrice), mrp: Number(row.mrp) })), after: rows }
        },
        tx
      );
      return tx.itemBranchPrice.findMany({ where: { branchId, itemId }, orderBy: { uom: 'asc' } });
    });
  }

  /**
   * Replaces an item's barcodes. Each is unique across items and never another item's code; a
   * sale unit named must be one the item is sold in (other than its base unit).
   */
  private async replaceBarcodes(tx: Prisma.TransactionClient, itemId: string, input: ItemBarcodeInput[]) {
    const item = await tx.item.findUniqueOrThrow({ where: { id: itemId }, select: { code: true, uom: true, saleUoms: { select: { uom: true, isDefault: true } } } });
    const rows = input.map((entry) => {
      const barcode = entry.barcode.trim();
      const wanted = entry.saleUom?.trim();
      const isBase = !wanted || wanted.toLowerCase() === item.uom.toLowerCase();
      const unit = isBase ? null : item.saleUoms.find((variant) => !variant.isDefault && variant.uom.toLowerCase() === wanted.toLowerCase());
      if (!isBase && !unit) throw new BadRequestException(`This item is not sold in ${wanted}`);
      return { itemId, barcode, saleUom: unit?.uom ?? null };
    });
    const codes = rows.map((row) => row.barcode);
    const itemWithCode = await tx.item.findFirst({ where: { code: { in: codes, mode: 'insensitive' }, id: { not: itemId } }, select: { code: true, name: true } });
    if (itemWithCode) throw new BadRequestException(`${itemWithCode.code} is the code of ${itemWithCode.name}`);
    const taken = await tx.itemBarcode.findFirst({ where: { barcode: { in: codes }, itemId: { not: itemId } }, select: { barcode: true, item: { select: { name: true } } } });
    if (taken) throw new BadRequestException(`Barcode ${taken.barcode} is already on ${taken.item.name}`);
    await tx.itemBarcode.deleteMany({ where: { itemId } });
    if (rows.length > 0) await tx.itemBarcode.createMany({ data: rows });
  }

  /**
   * Keeps branch prices on the item's units after they change: a renamed base unit takes its
   * prices along, and prices for units the item no longer has are dropped.
   */
  private async syncBranchPriceUnits(tx: Prisma.TransactionClient, itemId: string, previousBaseUom: string) {
    const item = await tx.item.findUniqueOrThrow({
      where: { id: itemId },
      select: { uom: true, saleUoms: { select: { uom: true } } }
    });
    if (previousBaseUom.toLowerCase() !== item.uom.toLowerCase()) {
      await tx.itemBranchPrice.deleteMany({ where: { itemId, uom: { equals: item.uom, mode: 'insensitive' } } });
      await tx.itemBranchPrice.updateMany({ where: { itemId, uom: previousBaseUom }, data: { uom: item.uom } });
    }
    const units = new Set([item.uom, ...item.saleUoms.map((unit) => unit.uom)].map((uom) => uom.toLowerCase()));
    const stale = (await tx.itemBranchPrice.findMany({ where: { itemId }, select: { uom: true } }))
      .map((price) => price.uom)
      .filter((uom) => !units.has(uom.toLowerCase()));
    if (stale.length > 0) {
      await tx.itemBranchPrice.deleteMany({ where: { itemId, uom: { in: stale } } });
    }
  }

  async createItem(session: SessionUser, input: {
    code: string;
    name: string;
    category?: string;
    uom: string;
    leastCount?: number;
    costPrice?: number;
    sellPrice: number;
    mrp?: number;
    saleUoms?: ItemSaleUomInput[];
    taxMode?: 'INCLUSIVE' | 'EXCLUSIVE';
    taxRate: number;
    hsnCode?: string | null;
    uqc?: string | null;
    supplyType?: GstSupplyType;
    imageUrl?: string;
    barcodes?: ItemBarcodeInput[];
    tracksBatches?: boolean;
  }) {
    const leastCount = normalizeLeastCount(input.leastCount ?? 1);
    const supplyType = input.supplyType ?? defaultSupplyType(input.taxRate);
    this.assertSupplyType(supplyType, input.taxRate);
    await this.assertHsnCode(input.hsnCode);
    const saleUoms = this.normalizeItemSaleUoms(input);
    await this.assertWithinMrp(saleUoms, { taxMode: input.taxMode ?? 'EXCLUSIVE', taxRate: input.taxRate });
    return this.prisma.$transaction(async (tx) => {
      // An item's code is scanned too, so it can't be another item's barcode.
      const barcodeOwner = await tx.itemBarcode.findFirst({ where: { barcode: { equals: input.code.trim(), mode: 'insensitive' } }, select: { item: { select: { name: true } } } });
      if (barcodeOwner) throw new BadRequestException(`${input.code} is a barcode of ${barcodeOwner.item.name}`);
      const created = await tx.item.create({
        data: {
          code: input.code,
          name: input.name,
          category: input.category,
          uom: input.uom,
          leastCount,
          costPrice: input.costPrice ?? 0,
          sellPrice: input.sellPrice,
          mrp: input.mrp ?? 0,
          taxMode: input.taxMode ?? 'EXCLUSIVE',
          taxRate: input.taxRate,
          hsnCode: input.hsnCode || null,
          uqc: input.uqc === undefined ? suggestUqc(input.uom) : input.uqc,
          supplyType,
          imageUrl: input.imageUrl,
          tracksBatches: input.tracksBatches ?? false,
          saleUoms: { create: saleUoms }
        },
        select: { id: true }
      });
      if (input.barcodes?.length) await this.replaceBarcodes(tx, created.id, input.barcodes);
      await this.audit.record(
        session,
        {
          action: 'ITEM_CREATED',
          entityType: 'Item',
          entityId: created.id,
          summary: `Added item ${input.code} ${input.name} at ${round2(input.sellPrice).toFixed(2)}`,
          details: { sellPrice: input.sellPrice, mrp: input.mrp ?? 0, taxRate: input.taxRate, taxMode: input.taxMode ?? 'EXCLUSIVE' }
        },
        tx
      );
      return tx.item.findUniqueOrThrow({ where: { id: created.id }, include: itemInclude });
    });
  }

  async updateItem(
    session: SessionUser,
    id: string,
    input: {
      name?: string;
      category?: string | null;
      uom?: string;
      leastCount?: number;
      costPrice?: number;
      sellPrice?: number;
      mrp?: number;
      saleUoms?: ItemSaleUomInput[];
      taxMode?: 'INCLUSIVE' | 'EXCLUSIVE';
      taxRate?: number;
      hsnCode?: string | null;
      uqc?: string | null;
      supplyType?: GstSupplyType;
      imageUrl?: string | null;
      isActive?: boolean;
      tracksBatches?: boolean;
      barcodes?: ItemBarcodeInput[];
    }
  ) {
    const { saleUoms: saleUomInput, barcodes: barcodeInput, ...data } = input;
    if (data.leastCount !== undefined) {
      data.leastCount = normalizeLeastCount(data.leastCount);
    }
    return this.prisma.$transaction(async (tx) => {
      const gst = await tx.item.findUnique({ where: { id }, select: { taxRate: true, supplyType: true, uqc: true, uom: true } });
      if (!gst) throw new NotFoundException('Item not found');
      const before = await tx.item.findUniqueOrThrow({ where: { id } });
      const taxRate = data.taxRate ?? toNumber(gst.taxRate);
      // Without a chosen supply type, keep the current one while it still fits the rate.
      data.supplyType =
        data.supplyType ?? (supplyTypeProblem(gst.supplyType, taxRate) ? defaultSupplyType(taxRate) : gst.supplyType);
      this.assertSupplyType(data.supplyType, taxRate);
      await this.assertHsnCode(data.hsnCode, tx);
      if (data.hsnCode === '') data.hsnCode = null;
      if (data.uqc === undefined && !gst.uqc) data.uqc = suggestUqc(data.uom ?? gst.uom);
      const previousBaseUom = gst.uom;

      if (saleUomInput !== undefined) {
        const current = await tx.item.findUnique({
          where: { id },
          select: { uom: true, sellPrice: true, mrp: true }
        });
        if (!current) throw new NotFoundException('Item not found');
        const nextSaleUoms = this.normalizeItemSaleUoms({
          uom: data.uom ?? current.uom,
          sellPrice: data.sellPrice ?? toNumber(current.sellPrice),
          mrp: data.mrp ?? toNumber(current.mrp),
          saleUoms: saleUomInput
        });
        await tx.itemSaleUom.deleteMany({ where: { itemId: id } });
        await tx.itemSaleUom.createMany({
          data: nextSaleUoms.map((variant) => ({ ...variant, itemId: id }))
        });
      }

      const updated = await tx.item.update({
        where: { id },
        data,
        include: itemInclude
      });
      if (data.uom !== undefined || saleUomInput !== undefined) {
        await this.syncBranchPriceUnits(tx, id, previousBaseUom);
        // Barcodes of sale units the item no longer has go too.
        const units = new Set(updated.saleUoms.filter((unit) => !unit.isDefault).map((unit) => unit.uom.toLowerCase()));
        const stale = (await tx.itemBarcode.findMany({ where: { itemId: id, saleUom: { not: null } }, select: { id: true, saleUom: true } }))
          .filter((row) => !units.has(row.saleUom!.toLowerCase()))
          .map((row) => row.id);
        if (stale.length > 0) await tx.itemBarcode.deleteMany({ where: { id: { in: stale } } });
      }
      if (barcodeInput !== undefined) await this.replaceBarcodes(tx, id, barcodeInput);
      // Prices, MRPs and tax as they now are, the branches' own prices too, all within the MRP.
      const branchPrices = await tx.itemBranchPrice.findMany({ where: { itemId: id }, select: { uom: true, sellPrice: true, mrp: true } });
      await this.assertWithinMrp(
        [
          { uom: updated.uom, sellPrice: toNumber(updated.sellPrice), mrp: toNumber(updated.mrp) },
          // The default row mirrors the base unit (the item's own price is what is charged).
          ...updated.saleUoms
            .filter((unit) => !unit.isDefault)
            .map((unit) => ({ uom: unit.uom, sellPrice: toNumber(unit.sellPrice), mrp: toNumber(unit.mrp) })),
          ...branchPrices.map((price) => ({ uom: price.uom, sellPrice: toNumber(price.sellPrice), mrp: toNumber(price.mrp) }))
        ],
        { taxMode: updated.taxMode, taxRate: toNumber(updated.taxRate) },
        tx
      );
      const changes = AuditService.changes(before, updated, AUDITED_ITEM_FIELDS);
      if (Object.keys(changes).length > 0 || saleUomInput !== undefined || barcodeInput !== undefined) {
        await this.audit.record(
          session,
          {
            action: changes.sellPrice || changes.mrp || changes.taxRate || changes.taxMode ? 'ITEM_PRICE_CHANGED' : 'ITEM_UPDATED',
            entityType: 'Item',
            entityId: id,
            summary: `Changed item ${updated.code} ${updated.name}: ${[...Object.keys(changes), ...(saleUomInput !== undefined ? ['sale units'] : []), ...(barcodeInput !== undefined ? ['barcodes'] : [])].join(', ') || 'no fields'}`,
            details: { changes, ...(saleUomInput !== undefined ? { saleUoms: saleUomInput } : {}), ...(barcodeInput !== undefined ? { barcodes: barcodeInput } : {}) } as Prisma.InputJsonValue
          },
          tx
        );
      }
      return tx.item.findUniqueOrThrow({ where: { id }, include: itemInclude });
    });
  }

  async deleteItem(session: SessionUser, id: string) {
    const salesCount = await this.prisma.saleInvoiceLine.count({ where: { itemId: id } });
    if (salesCount > 0) {
      throw new BadRequestException('Cannot delete item with sales history');
    }

    return this.prisma.$transaction(async (tx) => {
      const item = await tx.item.update({
        where: { id },
        data: { isActive: false }
      });
      await this.audit.record(session, { action: 'ITEM_REMOVED', entityType: 'Item', entityId: id, summary: `Removed item ${item.code} ${item.name}` }, tx);
      return item;
    });
  }
}
