-- Existing credit notes keep their historical totals. Only new returns reverse bill rounding.
ALTER TABLE "ReturnInvoice" ADD COLUMN "roundOff" DECIMAL(14,2) NOT NULL DEFAULT 0;
