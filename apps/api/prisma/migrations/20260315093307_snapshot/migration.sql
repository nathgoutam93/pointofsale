-- AlterTable
ALTER TABLE "SaleInvoice" ALTER COLUMN "customerName" DROP DEFAULT,
ALTER COLUMN "createdByName" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SaleInvoiceLine" ALTER COLUMN "itemName" DROP DEFAULT;
