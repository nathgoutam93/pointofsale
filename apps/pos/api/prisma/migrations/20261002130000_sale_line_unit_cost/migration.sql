-- AlterTable
ALTER TABLE "SaleInvoiceLine" ADD COLUMN     "unitCost" DECIMAL(14,4);


-- Best effort for sales made before cost was recorded: use the item's current cost price.
UPDATE "SaleInvoiceLine" AS l
SET "unitCost" = i."costPrice"
FROM "Item" AS i
WHERE i."id" = l."itemId" AND l."unitCost" IS NULL;
