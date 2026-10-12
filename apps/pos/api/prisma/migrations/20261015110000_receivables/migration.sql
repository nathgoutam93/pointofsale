-- Receivables: a credit limit and payment terms per customer, and each bill's due date.
ALTER TABLE "Customer" ADD COLUMN "creditLimit" DECIMAL(14,2),
ADD COLUMN "paymentTermsDays" INTEGER;

ALTER TABLE "SaleInvoice" ADD COLUMN "dueDate" TIMESTAMP(3);
