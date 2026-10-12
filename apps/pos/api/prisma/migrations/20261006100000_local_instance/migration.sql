-- CreateEnum
CREATE TYPE "LocalInstanceStatus" AS ENUM ('ACTIVE', 'MIGRATING', 'ARCHIVED');

-- CreateTable
CREATE TABLE "LocalInstance" (
    "id" TEXT NOT NULL DEFAULT 'local',
    "status" "LocalInstanceStatus" NOT NULL DEFAULT 'ACTIVE',
    "movedToBusinessId" TEXT,
    "movedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocalInstance_pkey" PRIMARY KEY ("id")
);
