 # B2B Additions Plan for a B2C-First POS

  ## Summary
  - Keep the POS centered on walk-in retail checkout.
  - Add only the B2B features that small business customers actually need: business profiles, credit sales, due dates, and
  outstanding tracking.
  - Reuse the existing customer, invoice, payment, and branch structure instead of introducing wholesale/ERP workflows.

  ## Phased Implementation

  ### Phase 1: Business customer identity
  - Add a customer account type: `RETAIL` or `BUSINESS`, defaulting to `RETAIL`.
  - Extend customer data with business fields: company name, GST/VAT number, billing address, shipping address, contact person,
  email, and credit flag.
  - Show these fields only in the Customers screen and only when a customer is marked as business.
  - Add invoice metadata for B2B printouts: buyer name, tax ID, address, and optional PO number.
  - Keep the existing POS flow unchanged for walk-in and retail customers.

  ### Phase 2: Credit sales and receivables
  - Add `paymentTerms` and `dueDate` to business customers or to individual invoices.
  - Add an `ON_ACCOUNT` payment mode for approved business customers only.
  - Track outstanding balance per customer and per invoice.
  - Add a simple receivables ledger with invoice amount, paid amount, outstanding amount, due date, and overdue status.
  - Add a lightweight “Settle Account” flow to record partial or full payments against outstanding invoices.
  - Keep cash/card/wallet as the default checkout path for B2C.

  ### Phase 3: B2B convenience features
  - Add optional quotation and quote-to-invoice conversion for business customers.
  - Add customer-specific price overrides or price lists for bulk buyers.
  - Add PO number, delivery note, and reference invoice fields on sales.
  - Add credit limit checks with warning/block behavior when a business customer exceeds approved credit.
  - Add statement and aging views for business accounts.

  ## Implementation Changes
  - Update Prisma models for customer account type, business profile fields, invoice payment terms, and receivables tracking.
  - Update contracts so customer create/update, sales create, and sales settle can carry business-specific fields without affecting
  retail checkout.
  - Update Customers page to manage business profiles and credit settings.
  - Update POS page to reveal B2B controls only after selecting a business customer.
  - Add a small Business Accounts view for outstanding balances, invoice history, and settlements.
  - Keep the existing wallet flow for retail customers; do not convert wallet into the B2B credit mechanism.

  ## Test Plan
  - Verify retail customers still behave exactly as before.
  - Verify business customers can be created and edited with company details.
  - Verify B2B invoices store tax ID, address, and optional PO number.
  - Verify `ON_ACCOUNT` sales create outstanding balances and due dates.
  - Verify partial payments reduce outstanding balances correctly.
  - Verify credit limit checks work as configured.
  - Verify walk-in flow does not expose B2B-only controls.

  ## Assumptions
  - B2B is a narrow extension of the current POS, not a separate wholesale module.
  - Business customers are a minority flow and should be hidden by default.
  - Full purchase-order, procurement, and vendor management are out of scope for now.
  - The first release should prioritize data capture and receivables, not pricing automation.
