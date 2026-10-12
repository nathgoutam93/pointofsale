-- GST document numbers: {series}/{FY}/{number}, counted per series and financial year.

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('INVOICE', 'RETURN');

-- CreateTable
CREATE TABLE "DocumentSequence" (
    "kind" "DocumentKind" NOT NULL,
    "series" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DocumentSequence_pkey" PRIMARY KEY ("kind","series","fiscalYear")
);

-- AlterTable
ALTER TABLE "SaleInvoice" ADD COLUMN "documentSeries" TEXT, ADD COLUMN "fiscalYear" INTEGER;
ALTER TABLE "ReturnInvoice" ADD COLUMN "documentSeries" TEXT, ADD COLUMN "fiscalYear" INTEGER;
ALTER TABLE "Branch" ALTER COLUMN "invoicePrefix" DROP DEFAULT, ALTER COLUMN "returnPrefix" DROP DEFAULT;

-- Each branch's invoice series: its code (letters and digits, first 5), or X0001... where
-- codes would clash. Every branch had the same INV prefix, which can't stay: series are unique.
WITH base AS (
  SELECT "id", left(upper(regexp_replace("code", '[^A-Za-z0-9]', '', 'g')), 5) AS b FROM "Branch"
), counted AS (
  SELECT "id", b, count(*) OVER (PARTITION BY b) AS n, row_number() OVER (ORDER BY b, "id") AS rn FROM base
)
UPDATE "Branch" br
SET "invoicePrefix" = CASE WHEN c.n = 1 AND c.b <> '' THEN c.b ELSE 'X' || lpad(c.rn::text, 4, '0') END
FROM counted c
WHERE c."id" = br."id";

-- Credit note series: the invoice series (first 4) with R, or R0001... where that would clash.
WITH base AS (
  SELECT "id", left("invoicePrefix", 4) || 'R' AS b FROM "Branch"
), counted AS (
  SELECT "id", b, count(*) OVER (PARTITION BY b) AS n, row_number() OVER (ORDER BY b, "id") AS rn FROM base
)
UPDATE "Branch" br
SET "returnPrefix" = CASE WHEN c.n = 1 THEN c.b ELSE 'R' || lpad(c.rn::text, 4, '0') END
FROM counted c
WHERE c."id" = br."id";

-- CreateIndex
CREATE UNIQUE INDEX "Branch_invoicePrefix_key" ON "Branch"("invoicePrefix");
CREATE UNIQUE INDEX "Branch_returnPrefix_key" ON "Branch"("returnPrefix");

-- Existing invoices and returns: their old-style series (the number without its count, e.g.
-- INV-MAIN) and the financial year they were made in, in the business time zone.
WITH tz AS (
  SELECT COALESCE((SELECT "timezone" FROM "BusinessSettings" WHERE "id" = 'default'), 'Asia/Kolkata') AS zone
), local AS (
  SELECT si."id", (si."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE tz.zone AS at FROM "SaleInvoice" si, tz
)
UPDATE "SaleInvoice" si
SET "documentSeries" = regexp_replace(si."invoiceNo", '-[0-9]+$', ''),
    "fiscalYear" = (EXTRACT(YEAR FROM l.at) - CASE WHEN EXTRACT(MONTH FROM l.at) < 4 THEN 1 ELSE 0 END)::int
FROM local l
WHERE l."id" = si."id";

WITH tz AS (
  SELECT COALESCE((SELECT "timezone" FROM "BusinessSettings" WHERE "id" = 'default'), 'Asia/Kolkata') AS zone
), local AS (
  SELECT r."id", (r."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE tz.zone AS at FROM "ReturnInvoice" r, tz
)
UPDATE "ReturnInvoice" r
SET "documentSeries" = regexp_replace(r."returnNo", '-[0-9]+$', ''),
    "fiscalYear" = (EXTRACT(YEAR FROM l.at) - CASE WHEN EXTRACT(MONTH FROM l.at) < 4 THEN 1 ELSE 0 END)::int
FROM local l
WHERE l."id" = r."id";
