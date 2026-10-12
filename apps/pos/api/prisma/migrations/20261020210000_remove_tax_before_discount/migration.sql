-- GST is charged on the value after the discounts shown on the invoice (CGST Act s.15(3)):
-- the "tax before discount" option is gone, and every business now works that way from its
-- next sale on. Bills already made keep the amounts they were made with.
ALTER TABLE "BusinessSettings" DROP COLUMN "taxCalculationMode";

DROP TYPE "TaxCalculationMode";
