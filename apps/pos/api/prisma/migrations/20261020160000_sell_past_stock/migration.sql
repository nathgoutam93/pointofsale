-- Selling more than the stock count shows (the count is wrong, the goods are on the counter):
-- off by default; when on, admins may, and cashiers given the permission.
ALTER TYPE "CashierPermission" ADD VALUE 'SELL_PAST_STOCK';
ALTER TABLE "BusinessSettings" ADD COLUMN "allowNegativeStock" BOOLEAN NOT NULL DEFAULT false;
