-- CreateTable
CREATE TABLE "FallbackBalance" (
    "customerId" TEXT NOT NULL,
    "owed" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "FallbackBalance_pkey" PRIMARY KEY ("customerId")
);

-- CreateTable
CREATE TABLE "FallbackCopiedDocument" (
    "id" TEXT NOT NULL,

    CONSTRAINT "FallbackCopiedDocument_pkey" PRIMARY KEY ("id")
);
