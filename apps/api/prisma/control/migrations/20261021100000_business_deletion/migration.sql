-- Owners can delete a business: locked at once, erased after a grace period, confirmed with
-- their password and a code emailed to them.

-- AlterEnum
ALTER TYPE "BusinessStatus" ADD VALUE 'DELETING';
ALTER TYPE "BusinessStatus" ADD VALUE 'DELETED';

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "deleteAfter" TIMESTAMP(3),
ADD COLUMN     "deletionRequestedBy" TEXT,
ADD COLUMN     "erasedAt" TIMESTAMP(3),
ADD COLUMN     "statusBeforeDeletion" "BusinessStatus";

-- CreateTable
CREATE TABLE "DeletionCode" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeletionCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeletionCode_accountId_businessId_idx" ON "DeletionCode"("accountId", "businessId");

-- AddForeignKey
ALTER TABLE "DeletionCode" ADD CONSTRAINT "DeletionCode_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

