ALTER TABLE "SaleInvoice"
ADD COLUMN "customerName" TEXT NOT NULL DEFAULT '',
ADD COLUMN "customerPhone" TEXT,
ADD COLUMN "createdByName" TEXT NOT NULL DEFAULT '';

ALTER TABLE "SaleInvoiceLine"
ADD COLUMN "itemName" TEXT NOT NULL DEFAULT '';

UPDATE "SaleInvoice" si
SET
  "customerName" = c."name",
  "customerPhone" = c."phone",
  "createdByName" = u."username"
FROM "Customer" c, "User" u
WHERE si."customerId" = c."id"
  AND si."createdBy" = u."id";

UPDATE "SaleInvoiceLine" sil
SET "itemName" = i."name"
FROM "Item" i
WHERE sil."itemId" = i."id";
