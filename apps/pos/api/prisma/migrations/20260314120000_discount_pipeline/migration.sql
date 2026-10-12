CREATE TYPE "TaxCalculationMode" AS ENUM ('AFTER_DISCOUNT', 'BEFORE_DISCOUNT');
CREATE TYPE "DiscountScope" AS ENUM ('ITEM', 'ORDER');
CREATE TYPE "DiscountType" AS ENUM ('PERCENTAGE', 'FIXED');

ALTER TABLE "BusinessSettings"
ADD COLUMN "taxCalculationMode" "TaxCalculationMode" NOT NULL DEFAULT 'AFTER_DISCOUNT';

CREATE TABLE "Discount" (
  "id" TEXT NOT NULL,
  "saleInvoiceId" TEXT NOT NULL,
  "scope" "DiscountScope" NOT NULL,
  "type" "DiscountType" NOT NULL,
  "value" DECIMAL(14,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Discount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiscountAllocation" (
  "id" TEXT NOT NULL,
  "discountId" TEXT NOT NULL,
  "saleInvoiceLineId" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,

  CONSTRAINT "DiscountAllocation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Discount_saleInvoiceId_scope_idx" ON "Discount"("saleInvoiceId", "scope");
CREATE INDEX "DiscountAllocation_discountId_idx" ON "DiscountAllocation"("discountId");
CREATE INDEX "DiscountAllocation_saleInvoiceLineId_idx" ON "DiscountAllocation"("saleInvoiceLineId");

ALTER TABLE "Discount"
ADD CONSTRAINT "Discount_saleInvoiceId_fkey" FOREIGN KEY ("saleInvoiceId") REFERENCES "SaleInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DiscountAllocation"
ADD CONSTRAINT "DiscountAllocation_discountId_fkey" FOREIGN KEY ("discountId") REFERENCES "Discount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DiscountAllocation"
ADD CONSTRAINT "DiscountAllocation_saleInvoiceLineId_fkey" FOREIGN KEY ("saleInvoiceLineId") REFERENCES "SaleInvoiceLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
