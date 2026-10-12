-- Nullable fields preserve existing receipts and checkout. Settlement callers supply a UUID
-- for each settlement and retain it until the server confirms the payment.
ALTER TABLE "Receipt"
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "requestFingerprint" TEXT,
  ADD COLUMN "settlementUserId" TEXT;

CREATE UNIQUE INDEX "Receipt_idempotencyKey_key" ON "Receipt"("idempotencyKey");
