-- Cashiers could make returns before the permission existed: they keep it until an admin takes
-- it away. New cashiers start without it. (Separate from the migration that adds the value, which
-- PostgreSQL won't let the same transaction use.)
UPDATE "User"
SET "permissions" = array_append("permissions", 'MAKE_RETURNS'::"CashierPermission")
WHERE "role" = 'CASHIER' AND NOT ('MAKE_RETURNS'::"CashierPermission" = ANY ("permissions"));
