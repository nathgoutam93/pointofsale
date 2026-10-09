ALTER TYPE "TaxpayerType" ADD VALUE 'UNREGISTERED';
ALTER TYPE "GstDocumentType" ADD VALUE 'INVOICE';
-- Preserve every existing invoice's registration/document snapshot and the legacy defaults.
-- New setup records an explicit type; existing owners choose a change through Settings.
