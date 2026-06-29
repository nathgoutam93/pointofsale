-- Add configurable per-item minimum sellable quantity.
ALTER TABLE "Item"
ADD COLUMN "leastCount" DECIMAL(14,3) NOT NULL DEFAULT 1;
