-- A return on a bill not yet paid in full first lowers what is still owed; only the rest is refunded.
ALTER TABLE "SaleInvoice" ADD COLUMN "creditedTotal" DECIMAL(14,2) NOT NULL DEFAULT 0;

ALTER TABLE "ReturnInvoice" ADD COLUMN "dueAdjusted" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN "refundAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- Returns so far were all on paid bills and refunded in full.
UPDATE "ReturnInvoice" SET "refundAmount" = "totalAmount";
