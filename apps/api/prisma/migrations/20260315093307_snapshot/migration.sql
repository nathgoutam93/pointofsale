DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'SaleInvoice'
      AND column_name = 'customerName'
  ) THEN
    ALTER TABLE "SaleInvoice" ALTER COLUMN "customerName" DROP DEFAULT;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'SaleInvoice'
      AND column_name = 'createdByName'
  ) THEN
    ALTER TABLE "SaleInvoice" ALTER COLUMN "createdByName" DROP DEFAULT;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'SaleInvoiceLine'
      AND column_name = 'itemName'
  ) THEN
    ALTER TABLE "SaleInvoiceLine" ALTER COLUMN "itemName" DROP DEFAULT;
  END IF;
END $$;
