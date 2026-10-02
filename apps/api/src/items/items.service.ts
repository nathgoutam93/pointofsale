import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { ItemSaleUomInput } from '../common/types';
import { toNumber, round2 } from '../common/numbers';
import { normalizeLeastCount } from '../common/quantities';

@Injectable()
export class ItemsService {
  constructor(
    private readonly prisma: PrismaService
  ) {}

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
        mrp: round2(input.mrp ?? input.sellPrice),
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
        mrp: round2(variant.mrp ?? variant.sellPrice),
        isDefault: false,
        sortOrder: normalized.length
      });
      seen.add(uom.toLowerCase());
    }

    return normalized;
  }

  async listItems(activeOnly?: boolean) {
    return this.prisma.item.findMany({
      where: activeOnly ? { isActive: true } : undefined,
      include: { saleUoms: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { createdAt: 'desc' }
    });
  }

  async createItem(input: {
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
    imageUrl?: string;
  }) {
    const leastCount = normalizeLeastCount(input.leastCount ?? 1);
    const saleUoms = this.normalizeItemSaleUoms(input);
    return this.prisma.item.create({
      data: {
        code: input.code,
        name: input.name,
        category: input.category,
        uom: input.uom,
        leastCount,
        costPrice: input.costPrice ?? 0,
        sellPrice: input.sellPrice,
        mrp: input.mrp ?? input.sellPrice,
        taxMode: input.taxMode ?? 'EXCLUSIVE',
        taxRate: input.taxRate,
        imageUrl: input.imageUrl,
        saleUoms: { create: saleUoms }
      },
      include: { saleUoms: { orderBy: { sortOrder: 'asc' } } }
    });
  }

  async updateItem(
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
      imageUrl?: string | null;
      isActive?: boolean;
    }
  ) {
    const { saleUoms: saleUomInput, ...data } = input;
    if (data.leastCount !== undefined) {
      data.leastCount = normalizeLeastCount(data.leastCount);
    }
    return this.prisma.$transaction(async (tx) => {
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

      return tx.item.update({
        where: { id },
        data,
        include: { saleUoms: { orderBy: { sortOrder: 'asc' } } }
      });
    });
  }

  async deleteItem(id: string) {
    const salesCount = await this.prisma.saleInvoiceLine.count({ where: { itemId: id } });
    if (salesCount > 0) {
      throw new BadRequestException('Cannot delete item with sales history');
    }

    return this.prisma.item.update({
      where: { id },
      data: { isActive: false }
    });
  }
}
