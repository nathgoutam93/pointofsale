import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { GstSupplyType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { SessionUser } from '../common/types';
import { toNumber } from '../common/numbers';
import { AuditService } from '../common/audit.service';
import { ItemsService, type NewItemInput } from './items.service';

export type ItemGroupInput = {
  name: string;
  codePrefix: string;
  category?: string;
  uom: string;
  option1Name: string;
  option1Values: string[];
  option2Name?: string;
  option2Values?: string[];
  costPrice?: number;
  sellPrice: number;
  mrp?: number;
  taxMode?: 'INCLUSIVE' | 'EXCLUSIVE';
  taxRate: number;
  hsnCode?: string | null;
  supplyType?: GstSupplyType;
  tracksBatches?: boolean;
};

type Combination = { option1: string; option2: string | null };

/** A value as it goes into an item code: letters and digits, upper case. */
const codePart = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]+/g, '');
const variantCode = (prefix: string, combination: Combination) =>
  [prefix.toUpperCase(), codePart(combination.option1), ...(combination.option2 === null ? [] : [codePart(combination.option2)])].join('-');
const variantName = (name: string, combination: Combination) => `${name} ${combination.option1}${combination.option2 === null ? '' : ` / ${combination.option2}`}`;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const groupInclude = {
  items: { orderBy: [{ createdAt: 'asc' }, { code: 'asc' }], select: { id: true, code: true, name: true, option1: true, option2: true, sellPrice: true, isActive: true } }
} satisfies Prisma.ItemGroupInclude;
const rank = (values: string[], value: string | null) => {
  const index = value === null ? -1 : values.indexOf(value);
  return index === -1 ? values.length : index;
};
const groupView = (group: Prisma.ItemGroupGetPayload<{ include: typeof groupInclude }>) => ({
  id: group.id,
  name: group.name,
  option1Name: group.option1Name,
  option2Name: group.option2Name,
  option1Values: group.option1Values,
  option2Values: group.option2Values,
  items: group.items
    .map((item) => ({ ...item, option1: item.option1 ?? '', sellPrice: toNumber(item.sellPrice) }))
    // In the order the values were given: by the first option, then the second.
    .sort((a, b) => rank(group.option1Values, a.option1) - rank(group.option1Values, b.option1) || rank(group.option2Values, a.option2) - rank(group.option2Values, b.option2))
});

/**
 * Products sold in sizes and/or colours. Each combination is an ordinary item (its own code,
 * barcodes, price, stock and batches), so selling, stock and GST need nothing new; the product
 * only groups them for the counter's picker. The caller checks who may.
 */
@Injectable()
export class ItemGroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly items: ItemsService,
    private readonly audit: AuditService
  ) {}

  async list() {
    const groups = await this.prisma.itemGroup.findMany({ orderBy: { name: 'asc' }, include: groupInclude });
    return groups.map(groupView);
  }

  private async detail(tx: Prisma.TransactionClient, id: string) {
    return groupView(await tx.itemGroup.findUniqueOrThrow({ where: { id }, include: groupInclude }));
  }

  /** Codes for the combinations, failing on one taken by an item or a barcode, or two that come out the same. */
  private async assertCodesFree(tx: Prisma.TransactionClient, codes: string[]) {
    const seen = new Set<string>();
    for (const code of codes) {
      if (/-$|--/.test(code)) throw new BadRequestException(`A value in ${code} has no letters or digits`);
      if (seen.has(code)) throw new BadRequestException(`Two values give the same item code, ${code}: name them differently`);
      seen.add(code);
    }
    const taken = await tx.item.findFirst({ where: { code: { in: codes, mode: 'insensitive' } }, select: { code: true, name: true } });
    if (taken) throw new BadRequestException(`Item code ${taken.code} is already ${taken.name}`);
    const barcode = await tx.itemBarcode.findFirst({ where: { barcode: { in: codes, mode: 'insensitive' } }, select: { barcode: true, item: { select: { name: true } } } });
    if (barcode) throw new BadRequestException(`${barcode.barcode} is a barcode of ${barcode.item.name}`);
  }

  private async insertVariants(tx: Prisma.TransactionClient, session: SessionUser, groupId: string, name: string, prefix: string, combinations: Combination[], base: Omit<NewItemInput, 'code' | 'name' | 'variant'>) {
    await this.assertCodesFree(tx, combinations.map((combination) => variantCode(prefix, combination)));
    const prepared = await this.items.prepareNewItem({ ...base, code: prefix, name });
    for (const combination of combinations) {
      await this.items.insertItem(
        tx,
        session,
        { ...base, code: variantCode(prefix, combination), name: variantName(name, combination), variant: { groupId, ...combination } },
        prepared
      );
    }
  }

  async create(session: SessionUser, input: ItemGroupInput) {
    const name = input.name.trim();
    const existing = await this.prisma.itemGroup.findFirst({ where: { name: { equals: name, mode: 'insensitive' } }, select: { id: true } });
    if (existing) throw new BadRequestException(`There is already a product named ${name}`);
    const combinations = input.option1Values.flatMap((option1): Combination[] =>
      input.option2Values ? input.option2Values.map((option2) => ({ option1: option1.trim(), option2: option2.trim() })) : [{ option1: option1.trim(), option2: null }]
    );
    const { codePrefix, option1Name, option1Values: _values1, option2Name, option2Values: _values2, ...base } = input;
    return this.prisma.$transaction(
      async (tx) => {
        const group = await tx.itemGroup.create({
          data: {
            name,
            option1Name: option1Name.trim(),
            option2Name: option2Name?.trim() || null,
            option1Values: input.option1Values.map((value) => value.trim()),
            option2Values: input.option2Values?.map((value) => value.trim()) ?? []
          }
        });
        await this.insertVariants(tx, session, group.id, name, codePrefix.trim(), combinations, base);
        await this.audit.record(
          session,
          {
            action: 'ITEM_GROUP_CREATED',
            entityType: 'ItemGroup',
            entityId: group.id,
            summary: `Added ${name} in ${combinations.length} ${combinations.length === 1 ? 'variant' : 'variants'}`,
            details: { option1Name, option1Values: input.option1Values, option2Name: option2Name ?? null, option2Values: input.option2Values ?? null }
          },
          tx
        );
        return this.detail(tx, group.id);
      },
      { timeout: 60_000 }
    );
  }

  /** New values for the product's options: an item for each new combination, copying its first item. */
  async addValues(session: SessionUser, id: string, input: { option1Values?: string[]; option2Values?: string[] }) {
    return this.prisma.$transaction(
      async (tx) => {
        // One change to a product at a time.
        await tx.$queryRaw`SELECT "id" FROM "ItemGroup" WHERE "id" = ${id} FOR UPDATE`;
        const group = await tx.itemGroup.findUnique({ where: { id }, include: { items: { orderBy: { createdAt: 'asc' } } } });
        if (!group) throw new NotFoundException('Product not found');
        if (input.option2Values && !group.option2Name) throw new BadRequestException(`${group.name} has no second option`);
        const template = group.items[0];
        if (!template) throw new BadRequestException(`${group.name} has no items left to copy`);

        const merge = (known: string[], current: Array<string | null>, added: string[] | undefined, optionName: string) => {
          // The values in their order, with any an item has that the list lacks.
          const values = [...new Set([...known, ...current.filter((value): value is string => value !== null)])];
          for (const value of added ?? []) {
            if (values.some((known) => same(known, value.trim()))) throw new BadRequestException(`${group.name} already has ${optionName} ${value.trim()}`);
            values.push(value.trim());
          }
          return values;
        };
        const values1 = merge(group.option1Values, group.items.map((item) => item.option1), input.option1Values, group.option1Name);
        const values2 = group.option2Name ? merge(group.option2Values, group.items.map((item) => item.option2), input.option2Values, group.option2Name) : null;
        const combinations = values1
          .flatMap((option1): Combination[] => (values2 ? values2.map((option2) => ({ option1, option2 })) : [{ option1, option2: null }]))
          .filter((combination) => !group.items.some((item) => same(item.option1 ?? '', combination.option1) && same(item.option2 ?? '', combination.option2 ?? '')));
        if (group.items.length + combinations.length > 200) throw new BadRequestException('A product has at most 200 variants');
        await tx.itemGroup.update({ where: { id }, data: { option1Values: values1, option2Values: values2 ?? [] } });

        // The first item's code is PREFIX-VALUE1[-VALUE2]: its prefix codes the new ones.
        const suffix = variantCode('', { option1: template.option1 ?? '', option2: template.option2 });
        const prefix = template.code.toUpperCase().endsWith(suffix) ? template.code.slice(0, template.code.length - suffix.length) : template.code;
        await this.insertVariants(tx, session, group.id, group.name, prefix, combinations, {
          category: template.category ?? undefined,
          uom: template.uom,
          leastCount: toNumber(template.leastCount),
          costPrice: toNumber(template.costPrice),
          sellPrice: toNumber(template.sellPrice),
          mrp: toNumber(template.mrp),
          taxMode: template.taxMode,
          taxRate: toNumber(template.taxRate),
          hsnCode: template.hsnCode,
          uqc: template.uqc,
          supplyType: template.supplyType,
          imageUrl: template.imageUrl ?? undefined,
          tracksBatches: template.tracksBatches
        });
        await this.audit.record(
          session,
          {
            action: 'ITEM_GROUP_VALUES_ADDED',
            entityType: 'ItemGroup',
            entityId: id,
            summary: `Added ${combinations.length} ${combinations.length === 1 ? 'variant' : 'variants'} of ${group.name}`,
            details: { option1Values: input.option1Values ?? null, option2Values: input.option2Values ?? null }
          },
          tx
        );
        return this.detail(tx, id);
      },
      { timeout: 60_000 }
    );
  }

  /** One price (and MRP) for every variant, checked against each one's MRP and tax first. */
  async setPrices(session: SessionUser, id: string, input: { sellPrice: number; mrp?: number }) {
    const group = await this.prisma.itemGroup.findUnique({ where: { id }, include: { items: { select: { id: true, uom: true, mrp: true, taxMode: true, taxRate: true } } } });
    if (!group) throw new NotFoundException('Product not found');
    for (const item of group.items) {
      await this.items.assertWithinMrp([{ uom: item.uom, sellPrice: input.sellPrice, mrp: input.mrp ?? toNumber(item.mrp) }], { taxMode: item.taxMode, taxRate: toNumber(item.taxRate) });
    }
    for (const item of group.items) {
      await this.items.updateItem(session, item.id, { sellPrice: input.sellPrice, ...(input.mrp !== undefined ? { mrp: input.mrp } : {}) });
    }
    return this.detail(this.prisma, id);
  }
}
