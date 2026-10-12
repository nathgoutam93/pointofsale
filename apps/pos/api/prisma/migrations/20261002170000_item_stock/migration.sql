-- CreateTable
CREATE TABLE "ItemStock" (
    "branchId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemStock_pkey" PRIMARY KEY ("branchId","itemId")
);

-- AddForeignKey
ALTER TABLE "ItemStock" ADD CONSTRAINT "ItemStock_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemStock" ADD CONSTRAINT "ItemStock_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Start from the existing history.
INSERT INTO "ItemStock" ("branchId", "itemId", "qty", "updatedAt")
SELECT "branchId", "itemId", SUM("qtyIn" - "qtyOut"), NOW()
FROM "StockLedger"
GROUP BY "branchId", "itemId";
