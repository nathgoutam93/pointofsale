-- Invoices and credit notes are now numbered per counter: {branch code}/{counter}/{YY}/{count}
-- (MAI/1/26/00001, credit notes MAIR/1/26/00001), so branch codes become exactly 3 letters
-- or digits and counters get a number. Documents already issued keep their numbers.

-- Branch codes that aren't 3 letters or digits take their first 3 (upper-cased, padded with
-- 0), or with a number in place of the last characters when that is taken: MAIN -> MAI,
-- then MA1 ... MA9, M10 ... M99, 100 ... 999.
DO $$
DECLARE
  branch_row RECORD;
  base TEXT;
  candidate TEXT;
  n INT;
BEGIN
  FOR branch_row IN
    SELECT "id", "code" FROM "Branch" WHERE "code" !~ '^[A-Z0-9]{3}$' ORDER BY "code", "id"
  LOOP
    base := rpad(left(upper(regexp_replace(branch_row."code", '[^A-Za-z0-9]', '', 'g')), 3), 3, '0');
    candidate := NULL;
    FOR n IN 0..999 LOOP
      candidate := CASE WHEN n = 0 THEN base ELSE left(base, 3 - length(n::text)) || n END;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM "Branch" WHERE "code" = candidate);
      candidate := NULL;
    END LOOP;
    IF candidate IS NULL THEN
      RAISE EXCEPTION 'No free 3-character code for branch %', branch_row."code";
    END IF;
    UPDATE "Branch" SET "code" = candidate WHERE "id" = branch_row."id";
  END LOOP;
END $$;

-- Counters are numbered 1, 2, 3... per branch in the order they were added.
ALTER TABLE "Counter" ADD COLUMN "number" INTEGER;

UPDATE "Counter" c
SET "number" = numbered.n
FROM (
  SELECT "id", row_number() OVER (PARTITION BY "branchId" ORDER BY "createdAt", "id") AS n FROM "Counter"
) numbered
WHERE numbered."id" = c."id";

ALTER TABLE "Counter" ALTER COLUMN "number" SET NOT NULL;

CREATE UNIQUE INDEX "Counter_branchId_number_key" ON "Counter"("branchId", "number");

-- The series come from the branch code and counter number now.
DROP INDEX "Branch_invoicePrefix_key";
DROP INDEX "Branch_returnPrefix_key";

ALTER TABLE "Branch" DROP COLUMN "invoicePrefix",
DROP COLUMN "returnPrefix";
