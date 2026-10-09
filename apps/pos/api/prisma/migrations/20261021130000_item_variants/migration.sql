-- Size/colour variants: products whose combinations are items of their own.
-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "groupId" TEXT,
ADD COLUMN     "option1" TEXT,
ADD COLUMN     "option2" TEXT;

-- CreateTable
CREATE TABLE "ItemGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "option1Name" TEXT NOT NULL,
    "option2Name" TEXT,
    "option1Values" TEXT[],
    "option2Values" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ItemGroup_name_key" ON "ItemGroup"("name");

-- CreateIndex
CREATE INDEX "Item_groupId_idx" ON "Item"("groupId");

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ItemGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- One item per combination of a product's options (Prisma can't express this index).
CREATE UNIQUE INDEX "Item_groupId_options_key" ON "Item"("groupId", "option1", COALESCE("option2", '')) WHERE "groupId" IS NOT NULL;
