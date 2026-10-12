-- Barcodes an item is scanned by besides its code (several EANs for one product, a box's own
-- barcode), and how the business's weighing scale prints its labels.
CREATE TABLE "ItemBarcode" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "saleUom" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemBarcode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ItemBarcode_barcode_key" ON "ItemBarcode"("barcode");
CREATE INDEX "ItemBarcode_itemId_idx" ON "ItemBarcode"("itemId");
ALTER TABLE "ItemBarcode" ADD CONSTRAINT "ItemBarcode_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BusinessSettings" ADD COLUMN "scaleBarcode" JSONB;
