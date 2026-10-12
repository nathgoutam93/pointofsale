DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TaxMode' AND typnamespace = current_schema()::regnamespace) THEN
    CREATE TYPE "TaxMode" AS ENUM ('INCLUSIVE', 'EXCLUSIVE');
  END IF;
END
$$;

ALTER TABLE "Item"
  ADD COLUMN "costPrice" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "taxMode" "TaxMode" NOT NULL DEFAULT 'EXCLUSIVE',
  ADD COLUMN "imageUrl" TEXT;
