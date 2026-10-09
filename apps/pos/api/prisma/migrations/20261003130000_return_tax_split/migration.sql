-- AlterTable
ALTER TABLE "ReturnInvoice" ADD COLUMN     "cgstTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "igstTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "sgstTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxableTotal" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ReturnInvoiceLine" ADD COLUMN     "cgstAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "igstAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "sgstAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxableAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- Existing return lines keep the refund they gave. Its tax is the sale line's share
-- (tax / net), split like the sale line: IGST, or CGST (half rounded down) + SGST.
UPDATE "ReturnInvoiceLine" rl
SET "taxAmount" = CASE WHEN sl."netAmount" > 0 THEN round(sl."taxAmount" * rl."amount" / sl."netAmount", 2) ELSE 0 END
FROM "SaleInvoiceLine" sl
WHERE sl."id" = rl."saleLineId";

UPDATE "ReturnInvoiceLine" rl
SET "taxableAmount" = rl."amount" - rl."taxAmount",
    "igstAmount" = CASE WHEN sl."igstAmount" > 0 THEN rl."taxAmount" ELSE 0 END,
    "cgstAmount" = CASE WHEN sl."igstAmount" > 0 THEN 0 ELSE floor(rl."taxAmount" * 100 / 2) / 100 END,
    "sgstAmount" = CASE WHEN sl."igstAmount" > 0 THEN 0 ELSE rl."taxAmount" - floor(rl."taxAmount" * 100 / 2) / 100 END
FROM "SaleInvoiceLine" sl
WHERE sl."id" = rl."saleLineId";

UPDATE "ReturnInvoice" r
SET "taxableTotal" = t.taxable, "taxTotal" = t.tax, "cgstTotal" = t.cgst, "sgstTotal" = t.sgst, "igstTotal" = t.igst
FROM (
  SELECT "returnInvoiceId", SUM("taxableAmount") AS taxable, SUM("taxAmount") AS tax,
         SUM("cgstAmount") AS cgst, SUM("sgstAmount") AS sgst, SUM("igstAmount") AS igst
  FROM "ReturnInvoiceLine" GROUP BY "returnInvoiceId"
) t
WHERE t."returnInvoiceId" = r."id";

-- A return line's parts add up to its refund, and it is CGST + SGST or IGST, never both.
ALTER TABLE "ReturnInvoiceLine" ADD CONSTRAINT "ReturnInvoiceLine_gst_split_check"
  CHECK ("taxAmount" = "cgstAmount" + "sgstAmount" + "igstAmount"
         AND "amount" = "taxableAmount" + "taxAmount"
         AND "taxableAmount" >= 0 AND "cgstAmount" >= 0 AND "sgstAmount" >= 0 AND "igstAmount" >= 0
         AND ("igstAmount" = 0 OR ("cgstAmount" = 0 AND "sgstAmount" = 0)));
