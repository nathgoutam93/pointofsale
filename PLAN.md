 Title
  Tax Calculation Pipeline + Discount Allocations (Global Business Config)

  Summary
  Implement a new order calculation pipeline supporting Tax‑After‑Discount and Tax‑Before‑Discount modes (configured in
  BusinessSettings). Replace legacy discountAmount/orderDiscountAmount inputs with structured discounts and persisted discount
  allocations. Update backend, contracts, and POS UI to align on the new calculation model and taxMode behavior.

  Key Changes

  1. Data Model
      - Add taxCalculationMode to BusinessSettings (enum: AFTER_DISCOUNT, BEFORE_DISCOUNT), default AFTER_DISCOUNT.
      - Add Discount table: id, saleInvoiceId, scope (ITEM|ORDER), type (PERCENTAGE|FIXED), value, createdAt.
      - Add DiscountAllocation table: id, discountId, saleInvoiceLineId, amount.
      - Relations:
          - SaleInvoice -> Discount[]
          - SaleInvoiceLine -> DiscountAllocation[]
  2. API / Contracts
      - Update sales.create request body:
          - lines: [{ itemId, qty, rate, taxRate, taxMode?, discounts?: [{ type, value }] }]
          - discounts?: [{ type, value }] (order‑level only).
          - Remove orderDiscountAmount and discountAmount from inputs.
      - Extend saleInvoice/saleInvoiceWithLines responses to include:
          - discounts: [{ id, scope, type, value }]
          - discountAllocations per line: [{ id, discountId, amount }]
      - Update business.get/business.update schemas to include taxCalculationMode.
  3. Calculation Pipeline
      - Normalize each line:
          - gross = qty * rate
          - baseExclusive = taxMode === INCLUSIVE && taxRate > 0 ? gross * 100 / (100 + taxRate) : gross
      - Item discounts (per line):
          - itemDiscount = sum( fixed + percent(baseExclusive) ), capped to baseExclusive.
          - baseAfterItem = baseExclusive - itemDiscount.
      - Order discount allocations:
          - Allocate order discounts across lines by baseAfterItem.
          - Order discount amounts are pre‑tax.
      - Tax‑After‑Discount mode:
          - taxable = max(0, baseAfterItem - orderAlloc)
          - tax = taxable * taxRate / 100
          - net = taxable + tax
      - Tax‑Before‑Discount mode:
          - taxable = max(0, baseAfterItem - orderAlloc)
          - tax = baseExclusive * taxRate / 100 (pre‑discount)
          - net = taxable + tax
      - Rounding:
          - Keep round2 at each monetary step: baseExclusive, discounts, allocations, taxable, tax, net, and totals.
  4. Persisting Discounts
      - On sale creation:
          - Create Discount records for each line‑level discount (scope ITEM) and order‑level discount (scope ORDER).
          - Create DiscountAllocation records for each discount/line pair (item discounts allocate to their own line; order
            discounts allocate across lines).
      - Continue populating SaleInvoiceLine.discountAmount with the sum of allocations for that line.
  5. UI Updates (POS)
      - Update POS create payload to send new discount shapes (per‑line discounts[], top‑level discounts[]).
      - Remove the taxMode conversion factor logic in PosPage.tsx and rely on backend handling.
      - Update the local totals/preview computation to mirror the new pipeline and taxMode handling.

  Public API/Interface Changes

  - New enum: taxCalculationMode.
  - New request shape for sales.create (structured discounts).
  - New response fields: invoice discounts, line discountAllocations.
  - Breaking change: remove orderDiscountAmount and line discountAmount inputs.

  Test Plan

  1. Tax‑After‑Discount / Exclusive
      - Single line, item discount + order discount, confirm tax recomputes on (taxable – order).
  2. Tax‑After‑Discount / Inclusive
      - Inclusive price, percent discount, verify base extraction, discounts applied pre‑tax, tax recomputed, net = taxable + tax.
  3. Tax‑Before‑Discount / Exclusive
      - Verify tax computed on pre‑discount base; discounts only reduce net, tax stays constant.
  4. Order Discount Allocation
      - Multiple lines, confirm allocation sums to order discount and rounding distributes cents correctly.
  5. Persistence
      - Sale creation stores Discount and DiscountAllocation records with correct scopes and amounts.

  Assumptions

  - Discounts are per‑line or order‑level only (no global/other scopes).
  - Percent discounts are computed on the base amount, not compounding.
  - POS UI is updated to align with the new API; backward compatibility is not required.

