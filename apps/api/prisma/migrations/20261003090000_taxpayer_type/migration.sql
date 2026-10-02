-- CreateEnum
CREATE TYPE "TaxpayerType" AS ENUM ('REGULAR', 'COMPOSITION');

-- CreateEnum
CREATE TYPE "CompositionCategory" AS ENUM ('MANUFACTURER', 'TRADER', 'RESTAURANT', 'SERVICES');

-- CreateEnum
CREATE TYPE "GstDocumentType" AS ENUM ('TAX_INVOICE', 'BILL_OF_SUPPLY');

-- AlterTable
ALTER TABLE "SaleInvoice" ADD COLUMN     "compositionCategory" "CompositionCategory",
ADD COLUMN     "documentType" "GstDocumentType" NOT NULL DEFAULT 'TAX_INVOICE',
ADD COLUMN     "taxpayerType" "TaxpayerType" NOT NULL DEFAULT 'REGULAR';

-- CreateTable
CREATE TABLE "TaxpayerTypeChange" (
    "id" TEXT NOT NULL,
    "taxpayerType" "TaxpayerType" NOT NULL,
    "compositionCategory" "CompositionCategory",
    "effectiveDate" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxpayerTypeChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaxpayerTypeChange_effectiveFrom_idx" ON "TaxpayerTypeChange"("effectiveFrom");

-- A composition taxpayer always has a category (it sets the rate); a regular one never does.
ALTER TABLE "TaxpayerTypeChange" ADD CONSTRAINT "TaxpayerTypeChange_category_check"
  CHECK (("taxpayerType" = 'COMPOSITION') = ("compositionCategory" IS NOT NULL));
ALTER TABLE "SaleInvoice" ADD CONSTRAINT "SaleInvoice_composition_category_check"
  CHECK (("taxpayerType" = 'COMPOSITION') = ("compositionCategory" IS NOT NULL));
