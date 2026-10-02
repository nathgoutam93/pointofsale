-- CreateEnum
CREATE TYPE "GstSupplyType" AS ENUM ('TAXABLE', 'NIL_RATED', 'EXEMPT', 'NON_GST');

-- AlterTable
ALTER TABLE "BusinessSettings" ADD COLUMN     "hsnMinDigits" INTEGER NOT NULL DEFAULT 4;

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "hsnCode" TEXT,
ADD COLUMN     "supplyType" "GstSupplyType" NOT NULL DEFAULT 'TAXABLE',
ADD COLUMN     "uqc" TEXT;

-- AlterTable
ALTER TABLE "SaleInvoiceLine" ADD COLUMN     "hsnCode" TEXT,
ADD COLUMN     "supplyType" "GstSupplyType" NOT NULL DEFAULT 'TAXABLE',
ADD COLUMN     "uqc" TEXT;

-- Existing items: a 0% item is nil rated until the admin says otherwise (exempt or non-GST).
UPDATE "Item" SET "supplyType" = 'NIL_RATED' WHERE "taxRate" = 0;

-- Existing items: the GST unit their unit name clearly means (PCS, kg, Litre...). The
-- rest stay empty for the admin to choose. Generated from UOM_TO_UQC in @pos/contracts.
UPDATE "Item" i
SET "uqc" = m.uqc
FROM (VALUES
  ('BAG', 'BAG'),
  ('BAL', 'BAL'),
  ('BDL', 'BDL'),
  ('BKL', 'BKL'),
  ('BOU', 'BOU'),
  ('BOX', 'BOX'),
  ('BTL', 'BTL'),
  ('BUN', 'BUN'),
  ('CAN', 'CAN'),
  ('CBM', 'CBM'),
  ('CCM', 'CCM'),
  ('CMS', 'CMS'),
  ('CTN', 'CTN'),
  ('DOZ', 'DOZ'),
  ('DRM', 'DRM'),
  ('GGK', 'GGK'),
  ('GMS', 'GMS'),
  ('GRS', 'GRS'),
  ('GYD', 'GYD'),
  ('KGS', 'KGS'),
  ('KLR', 'KLR'),
  ('KME', 'KME'),
  ('LTR', 'LTR'),
  ('MLT', 'MLT'),
  ('MTR', 'MTR'),
  ('MTS', 'MTS'),
  ('NOS', 'NOS'),
  ('OTH', 'OTH'),
  ('PAC', 'PAC'),
  ('PCS', 'PCS'),
  ('PRS', 'PRS'),
  ('QTL', 'QTL'),
  ('ROL', 'ROL'),
  ('SET', 'SET'),
  ('SQF', 'SQF'),
  ('SQM', 'SQM'),
  ('SQY', 'SQY'),
  ('TBS', 'TBS'),
  ('TGM', 'TGM'),
  ('THD', 'THD'),
  ('TON', 'TON'),
  ('TUB', 'TUB'),
  ('UGS', 'UGS'),
  ('UNT', 'UNT'),
  ('YDS', 'YDS'),
  ('PC', 'PCS'),
  ('PIECE', 'PCS'),
  ('PIECES', 'PCS'),
  ('NO', 'NOS'),
  ('NUMBER', 'NOS'),
  ('NUMBERS', 'NOS'),
  ('KG', 'KGS'),
  ('KILO', 'KGS'),
  ('KILOS', 'KGS'),
  ('KILOGRAM', 'KGS'),
  ('KILOGRAMS', 'KGS'),
  ('G', 'GMS'),
  ('GM', 'GMS'),
  ('GRM', 'GMS'),
  ('GRAM', 'GMS'),
  ('GRAMS', 'GMS'),
  ('L', 'LTR'),
  ('LT', 'LTR'),
  ('LITRE', 'LTR'),
  ('LITER', 'LTR'),
  ('LITRES', 'LTR'),
  ('LITERS', 'LTR'),
  ('ML', 'MLT'),
  ('MILLILITRE', 'MLT'),
  ('MILLILITER', 'MLT'),
  ('M', 'MTR'),
  ('METER', 'MTR'),
  ('METRE', 'MTR'),
  ('METERS', 'MTR'),
  ('METRES', 'MTR'),
  ('CM', 'CMS'),
  ('BOXES', 'BOX'),
  ('DOZEN', 'DOZ'),
  ('DZN', 'DOZ'),
  ('PKT', 'PAC'),
  ('PACK', 'PAC'),
  ('PACKS', 'PAC'),
  ('PACKET', 'PAC'),
  ('PACKETS', 'PAC'),
  ('SETS', 'SET'),
  ('PAIR', 'PRS'),
  ('PAIRS', 'PRS'),
  ('BOTTLE', 'BTL'),
  ('BOTTLES', 'BTL'),
  ('BAGS', 'BAG'),
  ('CARTON', 'CTN'),
  ('CARTONS', 'CTN'),
  ('ROLL', 'ROL'),
  ('ROLLS', 'ROL'),
  ('TONNE', 'TON'),
  ('TONNES', 'TON'),
  ('QUINTAL', 'QTL'),
  ('UNIT', 'UNT'),
  ('UNITS', 'UNT'),
  ('CANS', 'CAN'),
  ('TUBE', 'TUB'),
  ('TUBES', 'TUB'),
  ('TAB', 'TBS'),
  ('TABLET', 'TBS'),
  ('TABLETS', 'TBS'),
  ('BUNDLE', 'BDL'),
  ('BUNDLES', 'BDL'),
  ('SQFT', 'SQF'),
  ('SQMT', 'SQM')
) AS m(unit, uqc)
WHERE regexp_replace(upper(i."uom"), '[^A-Z]', '', 'g') = m.unit;

-- Existing sale lines: the item details as they are now (no HSN codes existed yet).
UPDATE "SaleInvoiceLine" l
SET "uqc" = i."uqc", "supplyType" = i."supplyType"
FROM "Item" i
WHERE i."id" = l."itemId";

-- A taxable item has a rate above 0; nil rated, exempt and non-GST items are at 0%.
ALTER TABLE "Item" ADD CONSTRAINT "Item_supply_type_rate_check"
  CHECK (("supplyType" = 'TAXABLE') = ("taxRate" > 0));
ALTER TABLE "BusinessSettings" ADD CONSTRAINT "BusinessSettings_hsn_min_digits_check"
  CHECK ("hsnMinDigits" IN (4, 6));
