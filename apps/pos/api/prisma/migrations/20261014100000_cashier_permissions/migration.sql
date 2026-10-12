-- What an admin lets a cashier do beyond selling.
CREATE TYPE "CashierPermission" AS ENUM ('MANAGE_STOCK', 'MANAGE_ITEMS', 'RECORD_PURCHASES', 'SEND_TRANSFERS', 'TOP_UP_WALLETS', 'CANCEL_SALES');

ALTER TABLE "User" ADD COLUMN "permissions" "CashierPermission"[] NOT NULL DEFAULT ARRAY[]::"CashierPermission"[];
