-- GST on purchases: each line's rate and tax by kind, the purchase's totals, the GSTIN it was
-- bought under, and whether its tax counts as input tax credit (GSTR-3B Table 4).
ALTER TABLE "PurchaseLine" ADD COLUMN "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseLine" ADD COLUMN "cgstAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseLine" ADD COLUMN "sgstAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseLine" ADD COLUMN "igstAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;

ALTER TABLE "Purchase" ADD COLUMN "buyerGstin" TEXT;
ALTER TABLE "Purchase" ADD COLUMN "taxTotal" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "Purchase" ADD COLUMN "cgstTotal" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "Purchase" ADD COLUMN "sgstTotal" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "Purchase" ADD COLUMN "igstTotal" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "Purchase" ADD COLUMN "itcEligible" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "Purchase_buyerGstin_createdAt_idx" ON "Purchase"("buyerGstin", "createdAt");
