-- Sessions expire. Those made before this get a day from when they were made, as new ones do.
-- AlterTable
ALTER TABLE "Session" ADD COLUMN "expiresAt" TIMESTAMP(3);
UPDATE "Session" SET "expiresAt" = "createdAt" + INTERVAL '24 hours';
ALTER TABLE "Session" ALTER COLUMN "expiresAt" SET NOT NULL;

-- CreateTable
CREATE TABLE "UncountedPayment" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRef" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "sessionId" TEXT,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refundedAt" TIMESTAMP(3),

    CONSTRAINT "UncountedPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Alert_sentAt_nextAttemptAt_idx" ON "Alert"("sentAt", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "Session_status_expiresAt_idx" ON "Session"("status", "expiresAt");
