-- Registered (B2B) buyers: a customer's GSTIN, billing address and email, and on each bill the
-- buyer's GSTIN and address as at the sale, with an optional order or reference number.
ALTER TABLE "Customer" ADD COLUMN "gstin" TEXT,
ADD COLUMN "address" TEXT,
ADD COLUMN "email" TEXT;

ALTER TABLE "SaleInvoice" ADD COLUMN "buyerGstin" TEXT,
ADD COLUMN "buyerAddress" TEXT,
ADD COLUMN "reference" TEXT;
