-- AlterTable
ALTER TABLE "SaleInvoice" ADD COLUMN     "cgstTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "igstTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "sgstTotal" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SaleInvoiceLine" ADD COLUMN     "cgstAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "igstAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "sgstAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- Existing sale lines: IGST when the goods went to another state, else CGST + SGST with
-- CGST the half rounded down to the paisa and SGST the rest (as splitGst does).
UPDATE "SaleInvoiceLine" l
SET "igstAmount" = l."taxAmount"
FROM "SaleInvoice" si
WHERE si."id" = l."invoiceId"
  AND si."placeOfSupplyStateCode" IS NOT NULL
  AND si."sellerStateCode" IS NOT NULL
  AND si."placeOfSupplyStateCode" <> si."sellerStateCode";

UPDATE "SaleInvoiceLine"
SET "cgstAmount" = floor("taxAmount" * 100 / 2) / 100,
    "sgstAmount" = "taxAmount" - floor("taxAmount" * 100 / 2) / 100
WHERE "igstAmount" = 0;

UPDATE "SaleInvoice" si
SET "cgstTotal" = t.cgst, "sgstTotal" = t.sgst, "igstTotal" = t.igst
FROM (
  SELECT "invoiceId", SUM("cgstAmount") AS cgst, SUM("sgstAmount") AS sgst, SUM("igstAmount") AS igst
  FROM "SaleInvoiceLine" GROUP BY "invoiceId"
) t
WHERE t."invoiceId" = si."id";

-- The kinds add up to the tax, and a line is either CGST + SGST or IGST, never both.
ALTER TABLE "SaleInvoiceLine" ADD CONSTRAINT "SaleInvoiceLine_gst_split_check"
  CHECK ("cgstAmount" + "sgstAmount" + "igstAmount" = "taxAmount"
         AND ("igstAmount" = 0 OR ("cgstAmount" = 0 AND "sgstAmount" = 0)));
