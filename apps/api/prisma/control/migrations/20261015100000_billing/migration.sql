-- CreateEnum
CREATE TYPE "CheckoutStatus" AS ENUM ('PENDING', 'PAID', 'FAILED');

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "billingNotice" TEXT,
ADD COLUMN     "paidUntil" TIMESTAMP(3),
ADD COLUMN     "plan" TEXT NOT NULL DEFAULT 'growth',
ADD COLUMN     "trialEndsAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "BillingCheckout" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "gst" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "gateway" TEXT NOT NULL,
    "gatewayRef" TEXT,
    "redirectUrl" TEXT,
    "status" "CheckoutStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "BillingCheckout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingEvent" (
    "gateway" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("gateway","eventId")
);

-- CreateTable
CREATE TABLE "BillingInvoice" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "checkoutId" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "buyerName" TEXT NOT NULL,
    "buyerGstin" TEXT,
    "buyerState" TEXT,
    "plan" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "amount" INTEGER NOT NULL,
    "cgst" INTEGER NOT NULL,
    "sgst" INTEGER NOT NULL,
    "igst" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,

    CONSTRAINT "BillingInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingInvoiceSequence" (
    "fiscalYear" INTEGER NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BillingInvoiceSequence_pkey" PRIMARY KEY ("fiscalYear")
);

-- CreateIndex
CREATE INDEX "BillingCheckout_businessId_idx" ON "BillingCheckout"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingCheckout_gateway_gatewayRef_key" ON "BillingCheckout"("gateway", "gatewayRef");

-- CreateIndex
CREATE UNIQUE INDEX "BillingInvoice_number_key" ON "BillingInvoice"("number");

-- CreateIndex
CREATE UNIQUE INDEX "BillingInvoice_checkoutId_key" ON "BillingInvoice"("checkoutId");

-- CreateIndex
CREATE INDEX "BillingInvoice_businessId_idx" ON "BillingInvoice"("businessId");

-- AddForeignKey
ALTER TABLE "BillingCheckout" ADD CONSTRAINT "BillingCheckout_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingInvoice" ADD CONSTRAINT "BillingInvoice_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingInvoice" ADD CONSTRAINT "BillingInvoice_checkoutId_fkey" FOREIGN KEY ("checkoutId") REFERENCES "BillingCheckout"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Businesses from before billing start a trial now, on the plan they already have.
UPDATE "Business" SET "trialEndsAt" = CURRENT_TIMESTAMP + INTERVAL '14 days' WHERE "trialEndsAt" IS NULL;
