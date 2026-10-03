-- AlterTable
ALTER TABLE "Counter" ADD COLUMN     "fallbackDeviceId" TEXT,
ADD COLUMN     "fallbackKeyHash" TEXT,
ADD COLUMN     "fallbackReceiptSeq" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "Counter_fallbackDeviceId_key" ON "Counter"("fallbackDeviceId");

