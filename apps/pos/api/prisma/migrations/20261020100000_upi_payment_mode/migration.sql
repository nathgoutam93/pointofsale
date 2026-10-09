-- UPI payments, kept apart from card so each can be reconciled with its own settlement.
ALTER TYPE "PaymentMode" ADD VALUE 'UPI';
