-- CreateTable
CREATE TABLE "Counter" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Counter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Counter_branchId_name_key" ON "Counter"("branchId", "name");
CREATE INDEX "Counter_branchId_idx" ON "Counter"("branchId");

ALTER TABLE "Counter" ADD CONSTRAINT "Counter_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every existing branch gets one counter, and its register history moves onto it.
INSERT INTO "Counter" ("id", "branchId", "name", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Counter 1', CURRENT_TIMESTAMP FROM "Branch";

ALTER TABLE "RegisterSession" ADD COLUMN "counterId" TEXT;

UPDATE "RegisterSession" r
SET "counterId" = c."id"
FROM "Counter" c
WHERE c."branchId" = r."branchId";

ALTER TABLE "RegisterSession" ALTER COLUMN "counterId" SET NOT NULL;

CREATE INDEX "RegisterSession_counterId_closedAt_idx" ON "RegisterSession"("counterId", "closedAt");

ALTER TABLE "RegisterSession" ADD CONSTRAINT "RegisterSession_counterId_fkey" FOREIGN KEY ("counterId") REFERENCES "Counter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
