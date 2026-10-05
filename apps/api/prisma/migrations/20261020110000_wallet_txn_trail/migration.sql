-- Who made each wallet entry and, for a top-up, how it was paid and on which register.
ALTER TABLE "WalletTxn" ADD COLUMN "createdBy" TEXT;
ALTER TABLE "WalletTxn" ADD COLUMN "createdByName" TEXT;
ALTER TABLE "WalletTxn" ADD COLUMN "paymentMode" "PaymentMode";
ALTER TABLE "WalletTxn" ADD COLUMN "registerSessionId" TEXT;
ALTER TABLE "WalletTxn" ADD COLUMN "reason" TEXT;

ALTER TABLE "WalletTxn" ADD CONSTRAINT "WalletTxn_registerSessionId_fkey" FOREIGN KEY ("registerSessionId") REFERENCES "RegisterSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "WalletTxn_registerSessionId_idx" ON "WalletTxn"("registerSessionId");
