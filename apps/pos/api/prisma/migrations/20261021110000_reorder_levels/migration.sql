-- Low stock: a reorder level and order quantity per item at each branch.
ALTER TABLE "ItemStock" ADD COLUMN "reorderLevel" DECIMAL(14,3),
ADD COLUMN "reorderQty" DECIMAL(14,3);
