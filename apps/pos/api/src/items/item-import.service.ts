import { Injectable } from '@nestjs/common';
import { Prisma, StockTxnType } from '@prisma/client';
import { calendarDateSchema, ITEM_IMPORT_COLUMNS, type ItemImportField } from '@pos/contracts';
import { PrismaService } from '../prisma.service';
import type { SessionUser } from '../common/types';
import { round2, round3, toNumber } from '../common/numbers';
import { assertQtyRespectsLeastCount, normalizeLeastCount } from '../common/quantities';
import { AuditService } from '../common/audit.service';
import { SettingsService } from '../settings/settings.service';
import { StockService } from '../stock/stock.service';
import { resolveBatch } from '../stock/batch-stock';
import { ItemsService, type ItemUpdateInput, type NewItemInput } from './items.service';

export type ImportRow = { row: number } & Partial<Record<ItemImportField, string | null>>;
type Issue = { row: number; message: string };
type Rights = { maySeeCosts: boolean; mayChangeStock: boolean };

const HEADERS = Object.fromEntries(ITEM_IMPORT_COLUMNS.map((column) => [column.field, column.header])) as Record<ItemImportField, string>;
const OPTION1 = 'Size';
const OPTION2 = 'Colour';

type Variant = { product: string; option1: string; option2: string | null };
type NewPlan = { row: number; input: NewItemInput; prepared: Awaited<ReturnType<ItemsService['prepareNewItem']>>; variant: Variant | null; opening: { qty: number; batchNo: string | null; expiryDate: string | null } | null };
type UpdatePlan = { row: number; id: string; update: ItemUpdateInput };
type LevelPlan = { row: number; code: string; reorderLevel: number | null; reorderQty: number | null };

const lower = (text: string) => text.toLowerCase();

/** A cell's text, trimmed; null when blank. */
function text(row: ImportRow, field: ItemImportField) {
  const value = row[field]?.trim();
  return value ? value : null;
}

/**
 * Items from a spreadsheet: every row checked first (with the same rules as the Items screen),
 * then, only with no errors, all saved in one transaction. The caller checks who may.
 */
@Injectable()
export class ItemImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly items: ItemsService,
    private readonly stock: StockService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService
  ) {}

  async import(session: SessionUser, input: { branchId: string; dryRun: boolean; rows: ImportRow[] }, rights: Rights) {
    await this.settings.ensureBranchExists(input.branchId);
    const errors: Issue[] = [];
    const warnings: Issue[] = [];

    // A number in a cell: "₹1,200.50" and "18%" are read as 1200.5 and 18.
    const number = (row: ImportRow, field: ItemImportField) => {
      const raw = text(row, field);
      if (raw === null) return null;
      const value = Number(raw.replace(/[₹,\s%]/g, '').replace(/^rs\.?/i, ''));
      if (!Number.isFinite(value)) {
        errors.push({ row: row.row, message: `${HEADERS[field]}: "${raw}" isn't a number` });
        return undefined;
      }
      if (value < 0) {
        errors.push({ row: row.row, message: `${HEADERS[field]} can't be below 0` });
        return undefined;
      }
      return value;
    };
    const yesNo = (row: ImportRow, field: ItemImportField) => {
      const raw = text(row, field);
      if (raw === null) return null;
      if (/^(y|yes|true|1|inclusive|incl)$/i.test(raw)) return true;
      if (/^(n|no|false|0|exclusive|excl)$/i.test(raw)) return false;
      errors.push({ row: row.row, message: `${HEADERS[field]}: say Yes or No, not "${raw}"` });
      return undefined;
    };

    const codes = input.rows.map((row) => text(row, 'code')).filter((code): code is string => code !== null);
    const fileBarcodes = input.rows.flatMap((row) => (text(row, 'barcodes') ?? '').split('|').map((code) => code.trim()).filter(Boolean));
    const products = [...new Set(input.rows.map((row) => text(row, 'product')).filter((name): name is string => name !== null))];
    const [existingItems, barcodeOwners, codeOwners, groups] = await Promise.all([
      this.prisma.item.findMany({
        where: { code: { in: codes, mode: 'insensitive' } },
        select: { id: true, code: true, name: true, uom: true, sellPrice: true, mrp: true, taxMode: true, taxRate: true, barcodes: { select: { barcode: true, saleUom: true } } }
      }),
      this.prisma.itemBarcode.findMany({ where: { barcode: { in: [...codes, ...fileBarcodes], mode: 'insensitive' } }, select: { barcode: true, itemId: true, item: { select: { code: true, name: true } } } }),
      this.prisma.item.findMany({ where: { code: { in: fileBarcodes, mode: 'insensitive' } }, select: { id: true, code: true, name: true } }),
      this.prisma.itemGroup.findMany({ where: { name: { in: products, mode: 'insensitive' } }, include: { items: { select: { option1: true, option2: true } } } })
    ]);
    const existingByCode = new Map(existingItems.map((item) => [lower(item.code), item]));
    const barcodeOwnerOf = new Map(barcodeOwners.map((owner) => [lower(owner.barcode), owner]));
    const codeOwnerOf = new Map(codeOwners.map((owner) => [lower(owner.code), owner]));
    const groupByName = new Map(groups.map((group) => [lower(group.name), group]));
    // Products new in this file have a second option when any of their rows names a colour.
    const newProductHasColour = new Map<string, boolean>();
    for (const row of input.rows) {
      const product = text(row, 'product');
      if (product && !groupByName.has(lower(product))) newProductHasColour.set(lower(product), (newProductHasColour.get(lower(product)) ?? false) || text(row, 'colour') !== null);
    }

    const seenCodes = new Map<string, number>();
    const seenBarcodes = new Map<string, number>();
    const seenCombinations = new Set<string>();
    const creates: NewPlan[] = [];
    const updates: UpdatePlan[] = [];
    const levels: LevelPlan[] = [];

    for (const row of input.rows) {
      const before = errors.length;
      const fail = (message: string) => errors.push({ row: row.row, message });
      const code = text(row, 'code');
      if (!code) {
        fail('Code is empty');
        continue;
      }
      if (seenCodes.has(lower(code))) {
        fail(`Code ${code} is also on row ${seenCodes.get(lower(code))}`);
        continue;
      }
      seenCodes.set(lower(code), row.row);

      const name = text(row, 'name');
      const category = text(row, 'category');
      const unit = text(row, 'unit');
      const sellPrice = number(row, 'sellPrice');
      const mrp = number(row, 'mrp');
      let costPrice = number(row, 'costPrice');
      const gstRate = number(row, 'gstRate');
      const inclusive = yesNo(row, 'priceIncludesGst');
      const hsnCode = text(row, 'hsnCode');
      const tracksBatches = yesNo(row, 'tracksBatches');
      const openingStock = number(row, 'openingStock');
      const batchNo = text(row, 'batchNo');
      const expiryDate = text(row, 'expiryDate');
      const reorderLevel = number(row, 'reorderLevel');
      const reorderQty = number(row, 'reorderQty');
      if (gstRate !== null && gstRate !== undefined && gstRate > 100) fail('GST % is at most 100');
      if (expiryDate !== null && !calendarDateSchema.safeParse(expiryDate).success) fail(`Expiry date: "${expiryDate}" isn't a date like 2027-03-31`);
      if (costPrice !== null && !rights.maySeeCosts) {
        warnings.push({ row: row.row, message: 'Cost price left out: you may not see or set costs' });
        costPrice = null;
      }
      if ((reorderLevel !== null || reorderQty !== null) && !rights.mayChangeStock) fail('Reorder levels need the permission to adjust stock');
      if (reorderQty !== null && reorderLevel === null) fail('Give the reorder level with the order quantity');

      // Barcodes: each once in the file, and not another item's barcode or code.
      const existing = existingByCode.get(lower(code)) ?? null;
      const barcodes = (text(row, 'barcodes') ?? '').split('|').map((value) => value.trim()).filter(Boolean);
      for (const barcode of barcodes) {
        if (barcode.length < 3 || barcode.length > 64) fail(`Barcode ${barcode} must be 3 to 64 characters`);
        if (seenBarcodes.has(lower(barcode))) fail(`Barcode ${barcode} is also on row ${seenBarcodes.get(lower(barcode))}`);
        seenBarcodes.set(lower(barcode), row.row);
        const owner = barcodeOwnerOf.get(lower(barcode));
        if (owner && owner.itemId !== existing?.id) fail(`Barcode ${barcode} is already on ${owner.item.name}`);
        const coded = codeOwnerOf.get(lower(barcode));
        if (coded && coded.id !== existing?.id) fail(`Barcode ${barcode} is the code of ${coded.name}`);
        if (seenCodes.has(lower(barcode)) && lower(barcode) !== lower(code)) fail(`Barcode ${barcode} is an item code in this file`);
      }

      if (existing) {
        // Blank cells leave the item as it is.
        const update: ItemUpdateInput = {
          ...(name ? { name } : {}),
          ...(category ? { category } : {}),
          ...(unit ? { uom: unit } : {}),
          ...(sellPrice != null ? { sellPrice } : {}),
          ...(mrp != null ? { mrp } : {}),
          ...(costPrice != null ? { costPrice } : {}),
          ...(gstRate != null ? { taxRate: gstRate } : {}),
          ...(inclusive != null ? { taxMode: inclusive ? 'INCLUSIVE' : 'EXCLUSIVE' } : {}),
          ...(hsnCode ? { hsnCode } : {}),
          ...(tracksBatches != null ? { tracksBatches } : {})
        };
        const added = barcodes.filter((barcode) => !existing.barcodes.some((entry) => lower(entry.barcode) === lower(barcode)));
        if (added.length > 0) update.barcodes = [...existing.barcodes, ...added.map((barcode) => ({ barcode, saleUom: null }))];
        if (openingStock) warnings.push({ row: row.row, message: `Opening stock left out: ${existing.name} is already there (use a stock adjustment)` });
        if (text(row, 'product')) warnings.push({ row: row.row, message: 'Product, size and colour are only read for new items' });
        if (update.sellPrice !== undefined || update.mrp !== undefined || update.taxRate !== undefined || update.taxMode !== undefined) {
          await this.items
            .assertWithinMrp(
              [{ uom: existing.uom, sellPrice: update.sellPrice ?? toNumber(existing.sellPrice), mrp: update.mrp ?? toNumber(existing.mrp) }],
              { taxMode: update.taxMode ?? existing.taxMode, taxRate: update.taxRate ?? toNumber(existing.taxRate) }
            )
            .catch((error: Error) => fail(error.message));
        }
        if (errors.length === before && Object.keys(update).length > 0) updates.push({ row: row.row, id: existing.id, update });
      } else {
        for (const [value, field] of [[name, 'name'], [unit, 'unit'], [sellPrice, 'sellPrice'], [gstRate, 'gstRate']] as const) {
          if (value === null) fail(`${HEADERS[field]} is needed for a new item`);
        }
        const blockingCode = barcodeOwnerOf.get(lower(code));
        if (blockingCode) fail(`Code ${code} is a barcode of ${blockingCode.item.name}`);

        let variant: Variant | null = null;
        const product = text(row, 'product');
        const size = text(row, 'size');
        const colour = text(row, 'colour');
        if (product) {
          const group = groupByName.get(lower(product));
          const hasColour = group ? group.option2Name !== null : newProductHasColour.get(lower(product))!;
          if (!size) fail(`Size is needed for a variant of ${product}`);
          else if (hasColour && !colour) fail(`${product} comes in colours: give this one's colour`);
          else if (!hasColour && colour) fail(`${product} has no colours`);
          else {
            variant = { product: group?.name ?? product, option1: size, option2: hasColour ? colour : null };
            const key = `${lower(product)}|${lower(size)}|${lower(colour ?? '')}`;
            const taken = seenCombinations.has(key) || group?.items.some((item) => lower(item.option1 ?? '') === lower(size) && lower(item.option2 ?? '') === lower(colour ?? ''));
            if (taken) fail(`${product} already has ${size}${colour ? ` / ${colour}` : ''}`);
            seenCombinations.add(key);
          }
        } else if (size || colour) {
          fail('Size and colour need the product they belong to');
        }

        const opening = openingStock ? { qty: openingStock, batchNo, expiryDate } : null;
        if (opening && !rights.mayChangeStock) fail('Opening stock needs the permission to adjust stock');
        if (opening && tracksBatches && !batchNo) fail('Give the batch of the opening stock (the item is kept by batch)');
        if (!opening && (batchNo || expiryDate)) warnings.push({ row: row.row, message: 'Batch and expiry are only read with opening stock' });

        if (errors.length === before) {
          const newItem: NewItemInput = {
            code,
            name: name!,
            category: category ?? undefined,
            uom: unit!,
            costPrice: costPrice ?? undefined,
            sellPrice: sellPrice!,
            mrp: mrp ?? undefined,
            taxMode: inclusive === false ? 'EXCLUSIVE' : 'INCLUSIVE',
            taxRate: gstRate!,
            hsnCode,
            tracksBatches: tracksBatches ?? false,
            barcodes: barcodes.map((barcode) => ({ barcode, saleUom: null }))
          };
          try {
            const prepared = await this.items.prepareNewItem(newItem);
            if (opening) assertQtyRespectsLeastCount(opening.qty, normalizeLeastCount(1), 'Opening stock');
            creates.push({ row: row.row, input: newItem, prepared, variant, opening });
          } catch (error) {
            fail((error as Error).message);
          }
        }
      }
      if (errors.length === before && (reorderLevel !== null || reorderQty !== null)) {
        levels.push({ row: row.row, code, reorderLevel: reorderLevel ?? null, reorderQty: reorderQty ?? null });
      }
    }

    const result = { created: creates.length, updated: updates.length, errors, warnings };
    if (input.dryRun || errors.length > 0) return { applied: false, ...result };

    await this.prisma.$transaction(
      async (tx) => {
        // Products new in the file, and new values for those already there, in the order met.
        const groupIds = new Map(groups.map((group) => [lower(group.name), group.id]));
        const variantsOf = new Map<string, Variant[]>();
        for (const plan of creates) {
          if (plan.variant) variantsOf.set(lower(plan.variant.product), [...(variantsOf.get(lower(plan.variant.product)) ?? []), plan.variant]);
        }
        for (const [key, variants] of variantsOf) {
          const values1 = [...new Set(variants.map((variant) => variant.option1))];
          const values2 = [...new Set(variants.map((variant) => variant.option2).filter((value): value is string => value !== null))];
          const group = groups.find((entry) => lower(entry.name) === key);
          if (group) {
            const append = (current: string[], added: string[]) => [...current, ...added.filter((value) => !current.some((known) => lower(known) === lower(value)))];
            await tx.itemGroup.update({ where: { id: group.id }, data: { option1Values: append(group.option1Values, values1), option2Values: append(group.option2Values, values2) } });
          } else {
            const created = await tx.itemGroup.create({
              data: { name: variants[0].product, option1Name: OPTION1, option2Name: values2.length > 0 ? OPTION2 : null, option1Values: values1, option2Values: values2 }
            });
            groupIds.set(key, created.id);
          }
        }

        const createdIds = new Map<string, { id: string; name: string }>();
        for (const plan of creates) {
          const variant = plan.variant ? { groupId: groupIds.get(lower(plan.variant.product))!, option1: plan.variant.option1, option2: plan.variant.option2 } : undefined;
          const item = await this.items.insertItem(tx, session, { ...plan.input, variant }, plan.prepared, { audit: false });
          createdIds.set(lower(plan.input.code), { id: item.id, name: item.name });
        }
        for (const plan of updates) {
          await this.items.applyItemUpdate(tx, session, plan.id, plan.update);
        }

        // Opening stock of the new items, at the branch.
        const entries: Parameters<StockService['recordStock']>[1] = [];
        for (const plan of creates) {
          if (!plan.opening) continue;
          const item = createdIds.get(lower(plan.input.code))!;
          const batch = plan.input.tracksBatches && plan.opening.batchNo ? await resolveBatch(tx, item, plan.opening.batchNo, plan.opening.expiryDate) : null;
          entries.push({
            branchId: input.branchId,
            itemId: item.id,
            txnType: StockTxnType.OPENING,
            qtyIn: round3(plan.opening.qty),
            qtyOut: 0,
            costPrice: round2(plan.input.costPrice ?? 0),
            reason: 'Opening stock (imported)',
            batchId: batch?.id ?? null
          });
        }
        await this.stock.recordStock(tx, entries);

        for (const level of levels) {
          const itemId = createdIds.get(lower(level.code))?.id ?? existingByCode.get(lower(level.code))!.id;
          await tx.itemStock.upsert({
            where: { branchId_itemId: { branchId: input.branchId, itemId } },
            create: { branchId: input.branchId, itemId, qty: 0, reorderLevel: level.reorderLevel, reorderQty: level.reorderQty },
            update: { reorderLevel: level.reorderLevel, reorderQty: level.reorderQty }
          });
        }

        await this.audit.record(
          session,
          {
            action: 'ITEMS_IMPORTED',
            entityType: 'Item',
            entityId: null,
            branchId: input.branchId,
            summary: `Imported items: ${creates.length} added, ${updates.length} changed`,
            details: { created: creates.map((plan) => plan.input.code), updated: updates.length, openingStock: entries.length } as Prisma.InputJsonValue
          },
          tx
        );
      },
      { timeout: 10 * 60_000, maxWait: 30_000 }
    );
    return { applied: true, ...result };
  }
}

