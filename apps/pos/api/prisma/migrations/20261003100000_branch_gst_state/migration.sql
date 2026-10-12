-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "gstin" TEXT,
ADD COLUMN     "stateCode" TEXT;

-- AlterTable
ALTER TABLE "SaleInvoice" ADD COLUMN     "placeOfSupplyStateCode" TEXT,
ADD COLUMN     "sellerGstin" TEXT,
ADD COLUMN     "sellerStateCode" TEXT;

-- A branch's own GSTIN is for the state the branch is in.
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_gstin_state_check"
  CHECK ("gstin" IS NULL OR substring("gstin" from 1 for 2) = "stateCode");

-- Existing branches: assume they are in the state of the business GSTIN, when it has a
-- usable one. Branches in other states have to be corrected in Branch Settings.
UPDATE "Branch" b
SET "stateCode" = substring(upper(trim(bs."gstNumber")) from 1 for 2)
FROM "BusinessSettings" bs
WHERE bs."id" = 'default'
  AND upper(trim(bs."gstNumber")) ~ '^(0[1-9]|1[0-9]|2[0-46-7]|29|3[0-8]|97)[A-Z0-9]{13}$';

-- Existing sales: sold over the counter at their branch, under the business GSTIN.
UPDATE "SaleInvoice" si
SET "sellerStateCode" = b."stateCode",
    "placeOfSupplyStateCode" = b."stateCode",
    "sellerGstin" = upper(trim(bs."gstNumber"))
FROM "Branch" b, "BusinessSettings" bs
WHERE b."id" = si."branchId" AND bs."id" = 'default' AND b."stateCode" IS NOT NULL;
