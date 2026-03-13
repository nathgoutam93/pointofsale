-- Add order-level discount amount to sale invoices
ALTER TABLE "SaleInvoice" ADD COLUMN "orderDiscountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;
