-- CreateTable
CREATE TABLE "CrashReport" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "appVersion" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "os" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "installId" TEXT,
    "businessId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrashReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrashReport_receivedAt_idx" ON "CrashReport"("receivedAt");

-- CreateIndex
CREATE INDEX "CrashReport_fingerprint_idx" ON "CrashReport"("fingerprint");
