-- Returns: a permission for cashiers, a reason and who made each one, and how many days after
-- a sale cashiers may still take its goods back.
ALTER TYPE "CashierPermission" ADD VALUE 'MAKE_RETURNS';

ALTER TABLE "BusinessSettings" ADD COLUMN "returnWindowDays" INTEGER;

ALTER TABLE "ReturnInvoice" ADD COLUMN "reason" TEXT;
ALTER TABLE "ReturnInvoice" ADD COLUMN "createdBy" TEXT;
ALTER TABLE "ReturnInvoice" ADD COLUMN "createdByName" TEXT;
