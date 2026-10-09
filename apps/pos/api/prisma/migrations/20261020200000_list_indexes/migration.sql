-- Indexes for lists and lookups that grow with every sale: a branch's bills by date, a bill's
-- lines, payments, receipts and returns, a customer's bills, a GSTIN's period, wallet entries.
CREATE INDEX "SaleInvoice_branchId_createdAt_idx" ON "SaleInvoice"("branchId", "createdAt");
CREATE INDEX "SaleInvoice_customerId_createdAt_idx" ON "SaleInvoice"("customerId", "createdAt");
CREATE INDEX "SaleInvoice_sellerGstin_createdAt_idx" ON "SaleInvoice"("sellerGstin", "createdAt");
CREATE INDEX "SaleInvoiceLine_invoiceId_idx" ON "SaleInvoiceLine"("invoiceId");
CREATE INDEX "SaleInvoiceLine_itemId_idx" ON "SaleInvoiceLine"("itemId");
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");
CREATE INDEX "Payment_createdAt_idx" ON "Payment"("createdAt");
CREATE INDEX "Receipt_invoiceId_idx" ON "Receipt"("invoiceId");
CREATE INDEX "ReturnInvoice_saleInvoiceId_idx" ON "ReturnInvoice"("saleInvoiceId");
CREATE INDEX "ReturnInvoice_createdAt_idx" ON "ReturnInvoice"("createdAt");
CREATE INDEX "ReturnInvoiceLine_returnInvoiceId_idx" ON "ReturnInvoiceLine"("returnInvoiceId");
CREATE INDEX "ReturnInvoiceLine_saleLineId_idx" ON "ReturnInvoiceLine"("saleLineId");
CREATE INDEX "WalletTxn_walletAccountId_createdAt_idx" ON "WalletTxn"("walletAccountId", "createdAt");
