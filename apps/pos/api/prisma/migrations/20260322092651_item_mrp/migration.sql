-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "mrp" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SaleInvoice" ALTER COLUMN "customerName" DROP DEFAULT,
ALTER COLUMN "createdByName" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SaleInvoiceLine" ALTER COLUMN "itemName" DROP DEFAULT;
