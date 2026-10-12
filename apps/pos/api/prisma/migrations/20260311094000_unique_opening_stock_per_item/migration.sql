CREATE UNIQUE INDEX "StockLedger_opening_unique_per_branch_item_idx"
ON "StockLedger" ("branchId", "itemId")
WHERE "txnType" = 'OPENING';
