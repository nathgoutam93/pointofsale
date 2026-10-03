import { z } from 'zod';

/**
 * The data bundle a single-counter (offline) business is exported as when it moves online.
 * It is a zip holding manifest.json, one tables/<Model>.ndjson per table and uploads/**.
 * The server inserts the rows itself; a bundle never carries SQL.
 */
export const MIGRATION_BUNDLE_FORMAT = 1;

/**
 * Every table in the bundle, parents before children so rows can be inserted in this order.
 * Names are Prisma model names. An API test fails when a model is neither here nor in
 * MIGRATION_EXCLUDED_MODELS, so a new table can't be left out of the move by accident.
 */
export const MIGRATION_TABLES = [
  'Branch',
  'BusinessSettings',
  'DocumentSequence',
  'TaxpayerTypeChange',
  'User',
  'UserBranchAccess',
  'Counter',
  'RegisterSession',
  'Customer',
  'WalletAccount',
  'WalletTxn',
  'Item',
  'ItemSaleUom',
  'ItemBranchPrice',
  'ItemStock',
  'StockLedger',
  'SaleInvoice',
  'SaleInvoiceLine',
  'Discount',
  'DiscountAllocation',
  'Payment',
  'Receipt',
  'ReturnInvoice',
  'ReturnInvoiceLine',
  'Purchase',
  'PurchaseLine',
  'StockTransfer',
  'StockTransferLine'
] as const;

/** Tables that describe this installation rather than the business, so they never move. */
export const MIGRATION_EXCLUDED_MODELS = ['LocalInstance'] as const;

export type MigrationTable = (typeof MIGRATION_TABLES)[number];

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

export const migrationManifestSchema = z.object({
  format: z.literal(MIGRATION_BUNDLE_FORMAT),
  appVersion: z.string(),
  /** The last migration applied to the exported database; the server must be on the same one. */
  schemaVersion: z.string(),
  exportedAt: z.string().datetime(),
  tables: z.array(
    z.object({
      name: z.enum(MIGRATION_TABLES),
      /** Path inside the zip, e.g. tables/Item.ndjson. One JSON object per line. */
      file: z.string(),
      rows: z.number().int().nonnegative(),
      sha256: sha256Schema
    })
  ),
  uploads: z.array(
    z.object({
      /** Path inside the zip, under uploads/, matching the /uploads/... URLs stored in rows. */
      file: z.string(),
      bytes: z.number().int().nonnegative(),
      sha256: sha256Schema
    })
  )
});

export type MigrationManifest = z.infer<typeof migrationManifestSchema>;
