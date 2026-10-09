-- AlterTable
ALTER TABLE "BusinessSettings" ADD COLUMN     "cashierMaxDiscountPercent" DECIMAL(5,2) NOT NULL DEFAULT 10;

-- AlterTable
ALTER TABLE "SaleInvoiceLine" ADD COLUMN     "listRate" DECIMAL(14,2);
