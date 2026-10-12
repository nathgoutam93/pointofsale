-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "registerSessionId" TEXT;

-- AlterTable
ALTER TABLE "RegisterSession" ADD COLUMN     "cashDifference" DECIMAL(14,2),
ADD COLUMN     "expectedCash" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "ReturnInvoice" ADD COLUMN     "registerSessionId" TEXT;

-- CreateIndex
CREATE INDEX "Payment_registerSessionId_idx" ON "Payment"("registerSessionId");

-- CreateIndex
CREATE INDEX "ReturnInvoice_registerSessionId_idx" ON "ReturnInvoice"("registerSessionId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_registerSessionId_fkey" FOREIGN KEY ("registerSessionId") REFERENCES "RegisterSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnInvoice" ADD CONSTRAINT "ReturnInvoice_registerSessionId_fkey" FOREIGN KEY ("registerSessionId") REFERENCES "RegisterSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

