-- Batches and expiry: items may keep their stock by batch (see Item.tracksBatches).

-- DropIndex
DROP INDEX "PurchaseLine_purchaseId_itemId_key";

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "tracksBatches" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PurchaseLine" ADD COLUMN     "batchId" TEXT;

-- AlterTable
ALTER TABLE "StockLedger" ADD COLUMN     "batchId" TEXT,
ADD COLUMN     "lineId" TEXT;

-- CreateTable
CREATE TABLE "ItemBatch" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "batchNo" TEXT NOT NULL,
    "expiryDate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchStock" (
    "branchId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BatchStock_pkey" PRIMARY KEY ("branchId","batchId")
);

-- CreateIndex
CREATE INDEX "ItemBatch_expiryDate_idx" ON "ItemBatch"("expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "ItemBatch_itemId_batchNo_key" ON "ItemBatch"("itemId", "batchNo");

-- CreateIndex
CREATE INDEX "BatchStock_batchId_idx" ON "BatchStock"("batchId");

-- CreateIndex
CREATE INDEX "PurchaseLine_purchaseId_idx" ON "PurchaseLine"("purchaseId");

-- CreateIndex
CREATE INDEX "StockLedger_lineId_idx" ON "StockLedger"("lineId");

-- CreateIndex
CREATE INDEX "StockLedger_batchId_idx" ON "StockLedger"("batchId");

-- AddForeignKey
ALTER TABLE "StockLedger" ADD CONSTRAINT "StockLedger_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ItemBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemBatch" ADD CONSTRAINT "ItemBatch_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchStock" ADD CONSTRAINT "BatchStock_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchStock" ADD CONSTRAINT "BatchStock_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ItemBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ItemBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- One opening count per branch and item, and per batch for items kept by batch.
DROP INDEX "StockLedger_opening_unique_per_branch_item_idx";
CREATE UNIQUE INDEX "StockLedger_opening_unique_per_branch_item_idx"
ON "StockLedger" ("branchId", "itemId", (COALESCE("batchId", '')))
WHERE "txnType" = 'OPENING';
