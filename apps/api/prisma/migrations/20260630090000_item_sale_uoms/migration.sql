CREATE TABLE "ItemSaleUom" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "uom" TEXT NOT NULL,
    "conversionQty" DECIMAL(14,3) NOT NULL,
    "sellPrice" DECIMAL(14,2) NOT NULL,
    "mrp" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemSaleUom_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "SaleInvoiceLine"
ADD COLUMN "saleUom" TEXT,
ADD COLUMN "saleUomQty" DECIMAL(14,3),
ADD COLUMN "saleUomConversionQty" DECIMAL(14,3);

INSERT INTO "ItemSaleUom" ("id", "itemId", "uom", "conversionQty", "sellPrice", "mrp", "isDefault", "sortOrder", "createdAt")
SELECT
    lower(
        substr(md5("id" || ':default-sale-uom'), 1, 8) || '-' ||
        substr(md5("id" || ':default-sale-uom'), 9, 4) || '-' ||
        substr(md5("id" || ':default-sale-uom'), 13, 4) || '-' ||
        substr(md5("id" || ':default-sale-uom'), 17, 4) || '-' ||
        substr(md5("id" || ':default-sale-uom'), 21, 12)
    ),
    "id",
    "uom",
    1,
    "sellPrice",
    "mrp",
    true,
    0,
    CURRENT_TIMESTAMP
FROM "Item";

CREATE UNIQUE INDEX "ItemSaleUom_itemId_uom_key" ON "ItemSaleUom"("itemId", "uom");
CREATE INDEX "ItemSaleUom_itemId_sortOrder_idx" ON "ItemSaleUom"("itemId", "sortOrder");

ALTER TABLE "ItemSaleUom"
ADD CONSTRAINT "ItemSaleUom_itemId_fkey"
FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
