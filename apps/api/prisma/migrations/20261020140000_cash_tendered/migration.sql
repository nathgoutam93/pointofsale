-- Cash handed over for a cash payment, when more than the payment: the rest was given back as change.
ALTER TABLE "Payment" ADD COLUMN "tendered" DECIMAL(14,2);
