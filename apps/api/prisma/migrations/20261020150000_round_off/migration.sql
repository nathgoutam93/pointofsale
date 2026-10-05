-- Rounding a bill's total to the rupee (or 50 paise), as a business setting, and the amount each bill was rounded by.
CREATE TYPE "RoundOffMode" AS ENUM ('NONE', 'NEAREST_1', 'NEAREST_050');
ALTER TABLE "BusinessSettings" ADD COLUMN "roundOffMode" "RoundOffMode" NOT NULL DEFAULT 'NONE';
ALTER TABLE "SaleInvoice" ADD COLUMN "roundOff" DECIMAL(14,2) NOT NULL DEFAULT 0;
