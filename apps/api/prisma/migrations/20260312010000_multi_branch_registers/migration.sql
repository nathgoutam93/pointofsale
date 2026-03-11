CREATE TABLE "UserBranchAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBranchAccess_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RegisterSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "openingBalance" DECIMAL(14,2) NOT NULL,
    "closingBalance" DECIMAL(14,2),
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegisterSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserBranchAccess_userId_branchId_key" ON "UserBranchAccess"("userId", "branchId");
CREATE INDEX "UserBranchAccess_branchId_idx" ON "UserBranchAccess"("branchId");
CREATE INDEX "RegisterSession_userId_closedAt_idx" ON "RegisterSession"("userId", "closedAt");
CREATE INDEX "RegisterSession_branchId_closedAt_idx" ON "RegisterSession"("branchId", "closedAt");

ALTER TABLE "UserBranchAccess" ADD CONSTRAINT "UserBranchAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserBranchAccess" ADD CONSTRAINT "UserBranchAccess_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RegisterSession" ADD CONSTRAINT "RegisterSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RegisterSession" ADD CONSTRAINT "RegisterSession_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "UserBranchAccess" ("id", "userId", "branchId", "createdAt")
SELECT 'uba_' || "id" || '_' || "branchId", "id", "branchId", CURRENT_TIMESTAMP
FROM "User"
ON CONFLICT ("userId", "branchId") DO NOTHING;
