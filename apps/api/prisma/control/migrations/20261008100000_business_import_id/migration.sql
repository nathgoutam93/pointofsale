-- AlterTable
ALTER TABLE "Business" ADD COLUMN "importId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Business_importId_key" ON "Business"("importId");
