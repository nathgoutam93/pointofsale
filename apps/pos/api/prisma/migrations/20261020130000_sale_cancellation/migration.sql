-- Who cancelled a bill, when and why.
ALTER TABLE "SaleInvoice" ADD COLUMN "cancelledAt" TIMESTAMP(3);
ALTER TABLE "SaleInvoice" ADD COLUMN "cancelledBy" TEXT;
ALTER TABLE "SaleInvoice" ADD COLUMN "cancelledByName" TEXT;
ALTER TABLE "SaleInvoice" ADD COLUMN "cancelReason" TEXT;
