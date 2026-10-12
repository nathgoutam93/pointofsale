-- AlterTable
ALTER TABLE "BusinessSettings" ADD COLUMN "recoveryCodeHash" TEXT,
ADD COLUMN "recoveryCodeCreatedAt" TIMESTAMP(3);
