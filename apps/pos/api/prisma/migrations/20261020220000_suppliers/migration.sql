-- Supplier accounts: suppliers, what purchases owe them, payments to them and goods sent
-- back to them (purchase returns, debit notes).

-- CreateEnum
CREATE TYPE "SupplierPaymentMode" AS ENUM ('CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE');

-- AlterEnum
ALTER TYPE "CashierPermission" ADD VALUE 'PAY_SUPPLIERS';

-- AlterEnum
ALTER TYPE "StockTxnType" ADD VALUE 'PURCHASE_RETURN';

-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "purchaseReturnSeq" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN     "dueDate" TEXT,
ADD COLUMN     "grandTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "settledBeforeAccounts" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "supplierId" TEXT;

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "gstin" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "paymentTermsDays" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPayment" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "mode" "SupplierPaymentMode" NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "registerSessionId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseReturn" (
    "id" TEXT NOT NULL,
    "returnNo" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "supplierId" TEXT,
    "reason" TEXT NOT NULL,
    "taxableTotal" DECIMAL(14,2) NOT NULL,
    "cgstTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sgstTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "igstTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "itcReversed" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseReturnLine" (
    "id" TEXT NOT NULL,
    "purchaseReturnId" TEXT NOT NULL,
    "purchaseLineId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "cgstAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sgstAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "igstAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "PurchaseReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_nameKey_key" ON "Supplier"("nameKey");

-- CreateIndex
CREATE INDEX "SupplierPayment_supplierId_createdAt_idx" ON "SupplierPayment"("supplierId", "createdAt");

-- CreateIndex
CREATE INDEX "SupplierPayment_registerSessionId_idx" ON "SupplierPayment"("registerSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseReturn_returnNo_key" ON "PurchaseReturn"("returnNo");

-- CreateIndex
CREATE INDEX "PurchaseReturn_branchId_createdAt_idx" ON "PurchaseReturn"("branchId", "createdAt");

-- CreateIndex
CREATE INDEX "PurchaseReturn_supplierId_createdAt_idx" ON "PurchaseReturn"("supplierId", "createdAt");

-- CreateIndex
CREATE INDEX "PurchaseReturn_purchaseId_idx" ON "PurchaseReturn"("purchaseId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseReturnLine_purchaseReturnId_purchaseLineId_key" ON "PurchaseReturnLine"("purchaseReturnId", "purchaseLineId");

-- CreateIndex
CREATE INDEX "Purchase_supplierId_createdAt_idx" ON "Purchase"("supplierId", "createdAt");

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturnLine" ADD CONSTRAINT "PurchaseReturnLine_purchaseReturnId_fkey" FOREIGN KEY ("purchaseReturnId") REFERENCES "PurchaseReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturnLine" ADD CONSTRAINT "PurchaseReturnLine_purchaseLineId_fkey" FOREIGN KEY ("purchaseLineId") REFERENCES "PurchaseLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturnLine" ADD CONSTRAINT "PurchaseReturnLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- What each purchase owes: its amount plus GST.
UPDATE "Purchase" SET "grandTotal" = "totalCost" + "taxTotal";

-- A supplier for each name purchases were recorded under (the latest GSTIN given for it), and
-- the purchases linked to it. Those purchases came before supplier accounts, so they count as
-- paid rather than as money owed now.
INSERT INTO "Supplier" ("id", "name", "nameKey", "gstin", "updatedAt")
SELECT gen_random_uuid()::text, named."name", named."nameKey", named."gstin", CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT ON (lower(btrim("supplierName")))
    btrim("supplierName") AS "name",
    lower(btrim("supplierName")) AS "nameKey",
    (SELECT p2."supplierGstin" FROM "Purchase" p2
      WHERE lower(btrim(p2."supplierName")) = lower(btrim(p."supplierName")) AND p2."supplierGstin" IS NOT NULL
      ORDER BY p2."createdAt" DESC LIMIT 1) AS "gstin"
  FROM "Purchase" p
  ORDER BY lower(btrim("supplierName")), "createdAt" DESC
) named;

UPDATE "Purchase" p SET "supplierId" = s."id", "settledBeforeAccounts" = true
FROM "Supplier" s
WHERE s."nameKey" = lower(btrim(p."supplierName"));
