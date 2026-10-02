-- CreateEnum
CREATE TYPE "CustomerScope" AS ENUM ('SHARED', 'BRANCH');

-- AlterTable
ALTER TABLE "BusinessSettings" ADD COLUMN     "customerScope" "CustomerScope" NOT NULL DEFAULT 'SHARED';

