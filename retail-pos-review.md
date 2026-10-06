# Retail POS review — 6 October 2026

This records the original review. Implementation progress, verified fixes and rollout requirements are tracked in [the fix plan](retail-pos-fix-plan.md); the findings below describe the code before those fixes.

## Assessment

The product has most of the functional breadth needed by a small Indian retailer. Its strongest areas are shared pricing calculations, transactional checkout, stock ledgers, credit customers, cashier permissions, and useful inventory and reporting screens.

I would fix the issues below before relying on it in a live shop. A supervised pilot is a reasonable next milestone after those fixes. The present implementation does not support a claim that it is ready for every retail vertical, accounting use, or every GST scenario.

This review examined the domain schema, API services and contracts, POS and related frontend workflows, desktop fallback and backup paths, tests, CI, and existing work trackers. Findings marked **reproduced** were exercised using the current source functions in memory; service reproductions used mocked persistence. Findings marked **source review** need integration regression tests. No application source was changed.

## Existing capabilities

| Area | Present in the implementation |
| --- | --- |
| Billing | Barcode scanning and scale labels, fractional quantities and alternate units, branch prices, MRP checks, line and bill discounts, cashier discount limits, held local carts, invoice numbering by counter and financial year |
| Payments | Cash tendered/change, manually recorded card and UPI payments, split and partial payments, customer wallets, credit sales |
| Customer accounts | Customer sharing configuration, credit limits, payment terms, due dates, ageing, statements and statement email, GST buyer details |
| Returns | Original invoice lookup, partial returns, quantity caps, credit notes, unpaid balance reduction before refund, return windows, same-branch restriction |
| Inventory | Stock ledger and on-hand balances, opening stock and adjustments, low-stock levels, transfers with dispatch/receipt, batches and expiry, size/colour variants, barcode labels, spreadsheet import |
| Purchasing | Suppliers, goods received, supplier balances and payments, purchase GST and supplier returns |
| Operations | Register opening/closing, expected cash and differences, cash in/out, expenses, cashier permissions, activity log, cost visibility restrictions |
| Documents and reporting | Thermal and A4 invoices, email receipts, sales/item/category/cashier reports, estimated profit, GST summaries and exports |
| Deployment and recovery | Desktop local database, online tenancy, one designated fallback counter per branch, offline outbox sync, backup/restore, data exports, updates and crash reporting |

These are code-supported capabilities, not a statement that every path was successfully exercised on this machine.

## Issues to address before a retail pilot

### 1. Missing unregistered-business tax mode — high priority, source review

The tax model offers only `REGULAR` and `COMPOSITION`. With no historical change, settings default to `REGULAR`. Sales decide whether to charge tax from that type before resolving the seller GSTIN, and do not reject a taxable sale when the GSTIN is absent.

Consequently an unregistered shop can be configured with taxed products and issue a document titled TAX INVOICE with GST charged and no seller GSTIN. Setting every item to zero tax is an unreliable workaround and loses the distinction between the seller's registration and the product's tax classification.

Add an explicit unregistered state, ordinary sale documents, and registration-aware tax enforcement. Preserve product tax classifications for later registration changes. This matters because an unregistered person may not collect GST as tax under [CGST Act section 32](https://cbic-gst.gov.in/hindi/CGST-bill-e.html).

Evidence: `packages/contracts/src/gst.ts:7`, `apps/api/src/settings/settings.service.ts:216`, `apps/api/src/sales/sales.service.ts:73`.

### 2. Fallback selling loses expiry protection — high priority, reproduced selection logic

`FallbackService.snapshot` copies total item stock but omits `ItemBatch` and `BatchStock`. The local API therefore sees that quantity as unbatched stock, which batch picking permits before dated batches. Sync subsequently assigns offline movements to batches with `includeExpired: true`.

Reproduction: ten units entirely in an expired batch give an online pick of zero units and a shortage of one; the fallback representation permits that one unit as unbatched stock. It also cannot print the actual batch at the time of sale.

Copy the batch records and quantities, enforce expiry locally, and sync the batch selections actually made. Review the online negative-stock override too: `allowShort` can replace unavailable nonexpired batch stock with an unbatched movement even when the physical stock remaining is expired.

Evidence: `apps/api/src/fallback/fallback.service.ts:155`, `apps/api/src/fallback/offline-batches.ts:31`, `apps/api/src/stock/batch-stock.ts:59`.

### 3. Fallback closing cash omits online activity — high priority, source review

The snapshot copies the open register and its original opening balance but omits its existing payments, wallet top-ups, supplier payments, cash movements and expenses. Some copied returns can still be present. `registerCash` calculates expected cash from these transaction tables, so the offline calculation is incomplete. Sync accepts the offline register's expected cash and difference without recalculating them after inserting the movements.

Example: a drawer opened with ₹100 and took ₹118 online. After a refresh, the local copy still has an opening balance of ₹100 but no corresponding online payment. With no further transactions, closing it with the actual ₹218 can show a false ₹118 surplus.

Carry a cash baseline at the snapshot cutoff plus subsequent movements, or copy the relevant register history while explicitly excluding copied history from the outbox. Recompute and reconcile closing values on the server.

Evidence: `apps/api/src/fallback/fallback.service.ts:155` and `:309`, `apps/api/src/registers/registers.service.ts:57`.

### 4. Retrying a partial settlement records payment twice — high priority, reproduced with mocked persistence

Checkout has idempotency protection, but `/sales/:id/settle` does not. Locking an invoice serializes requests; it does not identify a retry. When the first partial payment commits and its response is lost, submitting it again applies a second payment while the invoice remains unpaid.

Reproduction using `SaleSettlementService`: a ₹200 credit bill and the same ₹60 settlement submitted twice produce ₹120 paid and two payment records. A retry that exceeds the remaining due can also create an unintended wallet top-up for a named customer.

Give settlements durable operation IDs, retain them across UI retries/reloads, and return the original result on replay. Extend the same protection to wallet top-ups, supplier payments, refunds, purchases and cash movements where repeated requests can duplicate a financial action. Checkout's current key lives in a React ref, so recovery across page reloads also needs attention.

Evidence: `packages/contracts/src/contract/sales.ts:263`, `apps/api/src/sales/sale-settlement.service.ts:28`, `apps/web/src/screens/pos/useCheckout.ts:85`.

### 5. Fallback cancellation is already blocked — corrected during implementation

The original review missed the request middleware in `configureApp`: the fallback write allowlist excludes `/sales/:id/cancel`. Normal API clients receive `403 FALLBACK_UNAVAILABLE` before the cancellation service runs.

The verifier reproduction used a manually constructed CANCELLED outbox. It showed that cancellation sync is unsupported, but did not establish a reachable application defect. Cancellation should remain unavailable offline until its state and reversal movements are supported end to end. Add an HTTP regression asserting the rejection and unchanged invoice/stock.

Evidence: `apps/api/src/app-config.ts:105`, `apps/api/src/fallback/outbox.ts` (`FALLBACK_WRITES`).

### 6. Full returns do not reconcile invoice round-off — high priority, reproduced money functions

Returns refund line values, but their cap is the rounded amount paid. With nearest-rupee rounding:

- Goods worth ₹100.40 are paid as ₹100. Returning all goods requests ₹100.40 and fails the refund cap.
- Goods worth ₹100.60 are paid as ₹101. Returning all goods refunds ₹100.60, leaving ₹0.40 with the shop.

The existing round-off integration test covers the rounded-up case and explicitly expects the line value. It does not cover the rounded-down failure.

Define a return-rounding policy and allocate/reverse the invoice adjustment without changing the tax components incorrectly. Check full and repeated partial returns on paid, partially paid and entirely unpaid invoices.

Evidence: `apps/api/src/returns/returns.service.ts:190`, `packages/contracts/src/pricing.ts:109`, `apps/api/test/round-off.test.ts:37`.

## Other business-logic gaps

| Gap | Current behavior and recommended treatment |
| --- | --- |
| Damaged returns and exchanges | Every return adds the goods back to stock. Add a per-line disposition: resell, quarantine, damage or supplier return. Refund choices are only cash and wallet; add a controlled card/UPI refund workflow and references. A linked return/new-sale exchange would help clothing shops. Evidence: `returns.service.ts:251`, sales return contract. |
| Duplicate supplier invoices | Supplier invoice numbers are optional and have no duplicate check or database uniqueness rule. Re-entering or retrying a purchase can add stock, liability and input-tax estimates twice. Add request idempotency and duplicate detection using supplier, buying entity, financial year and normalized invoice number, with an explicit override where justified. Evidence: `purchases.service.ts:106`, schema `Purchase:838`. |
| Estimated inventory costing | Latest purchase cost overwrites the business-wide item cost; sales copy that value regardless of branch or batch. Stock bought at ₹50 can be costed at ₹80 after a later purchase at another branch. Keeping the latest purchase price was an explicit prior product decision. Preserve that field, but separate it from stock valuation and accounting COGS, or label profit as an estimate. Evidence: `purchases.service.ts:140`, `sale-lines.ts:146`, `reports.service.ts:45`. |
| Cash payout controls | Supplier drawer payments and cash returns check an open register but not available cash. Expense/cash-out checks read the balance under a shared register lock, allowing concurrent withdrawals to both pass. Serialize balance-sensitive payouts and make insufficient-cash handling consistent. Evidence: `suppliers.service.ts:171`, `expenses.service.ts:44`, `common/register-open.ts:14`. Concurrency consequence is inferred from source, not database-tested here. |
| Historical invoice identity | Seller GSTIN and buyer details are snapshotted, but store name and receipt address/header are read from current settings when reprinting/emailing. Save the legal seller identity/address with each invoice. Also preserve any historical unit/MRP fields the printed document depends on. Evidence: `screens/sales/useReceiptSettings.ts`, `sales/receipt-email.service.ts:44`, schema `SaleInvoice`. |
| Variant metadata in fallback | `Item` rows retain `groupId`, but the snapshot omits `ItemGroup`. Restore disables FK triggers while loading and does not validate the relationships afterwards. Add group metadata and an explicit post-restore integrity check; exercise variant listing and scanning offline. Exact runtime failure requires integration verification. Evidence: `fallback.service.ts:179`, `backup/local-backup.ts:413`. |
| Purchasing workflow depth | Purchase lines lack invoice discounts, freight/landed costs, supplier round-off and purchase-unit conversion. These are common reasons a recorded payable will differ from the supplier's bill. Transfers receive all quantities at once; shortages, partial receipts and damaged-in-transit stock need an exception workflow. |
| Scale evidence | POS fetches the entire active catalog and branch stock, then filters locally. Some purchase/transfer lists stop at 200 without pagination. Benchmark a realistically large catalog and concurrent tills; add search/pagination where needed. Evidence: `screens/pos/useCatalog.ts`, purchase/transfer list services. |

## Missing features, ranked by retail use

**Next for general retail:** a stocktake workflow with count sessions and reviewed variances; promotions such as quantity breaks and buy-X-get-Y; damage/wastage reporting; purchase orders and partial goods receipts; payment-provider/bank reconciliation; opening customer/supplier balances and more complete migration tools; accountant-friendly exports or accounting integration.

**Useful later:** loyalty, customer price groups, digital receipt links/WhatsApp, customer display, manager approval at the till, quotations and delivery challans, optional stronger owner authentication.

**Vertical-specific:** pharmacy needs reliable offline batch/expiry and applicable prescription controls; electronics needs serial/IMEI and warranty tracking; fashion benefits from exchanges and seasonal markdowns; grocery/supermarkets need promotions and tested scale workflows. Existing weight-encoded barcode support does not establish direct integration with a weighing scale.

**Larger/more regulated businesses:** e-invoicing/IRN, e-way bills, broader tax scenarios, accounting period controls and formal stock valuation. E-invoicing eligibility is not determined just by today's sales: qualifying historical aggregate turnover and exemptions matter. The official IRP explains the [₹5 crore threshold](https://einvoice6.gst.gov.in/content/new-advisory-on-e-invoicing-enablement-status-update-for-taxpayers/). E-way bill requirements depend on the movement/consignment and applicable exceptions, so small shop size alone is insufficient; the [official FAQ](https://docs.ewaybillgst.gov.in/html/faq_new.html) explains the general ₹50,000 consignment threshold.

The current GST reports are preparation aids. `buildGstr3b` estimates purchase ITC and already warns users to check it against GSTR-2B; it has no reconciliation workflow, and reverse-charge/zero-rated sections are zero placeholders. Supplier registration alone does not settle all eligibility conditions. See the [GST portal's GSTR-2B guidance](https://tutorial.gst.gov.in/userguide/returns/FAQ_gstr2b.htm). Do not present these outputs as complete filing automation.

The existing `post-launch-tracker.md` already records several missing features. Their priority should depend on the chosen shop type; promotions, stocktake and damage handling may be more valuable than loyalty for the first stores.

## Code quality and verification

Positive design choices include shared pricing between frontend and API, decimal database columns, transactions for sales/stock/wallet changes, sorted stock locks, conditional wallet debits, counter-specific document sequences, typed validated contracts, per-request session/branch rechecks, and extensive integration-test source. CI includes lint, types, unit/API tests and browser workflows on pull requests.

The main architectural concern is duplication of business rules in fallback snapshot/export/verification/import. New features can be added online while their data and state transitions are omitted offline. Treat the fallback dependency graph and supported operations as an explicit contract, and add cross-workflow tests when that contract changes.

Verification performed:

- Contracts: **164 tests passed across 11 files**.
- Contracts and shared types: individual TypeScript checks passed.
- Executed source reproductions for round-off returns, cancelled offline invoice verification, and batch picking with the fallback representation.
- Executed the actual settlement service with mocked persistence to demonstrate a duplicate partial payment.
- API integration tests could not start because PostgreSQL was unavailable at localhost:5432. An initial SWC cache permission issue was resolved by directing its cache to `/private/tmp`.
- Web tests could not start because the existing web dependency installation lacks Vitest. API/web/desktop typechecks were not clean in this checkout: API has stale generated Prisma types/missing packages, web has missing declared dependencies, and desktop lacks its Node type definitions. These are environment limitations; they do not establish equivalent failures after a clean install and client generation.
- The pnpm wrapper attempted an unavailable package-manager download, so successful checks used the already installed executables directly.

No complete database, browser, packaged-desktop, hardware, load or restore acceptance run was possible here. Deployment backup configuration and production monitoring were not inspected on a live server.

## Recommended delivery order

1. Fix tax registration mode, fallback expiry/cash, settlement retries and return rounding; cover the existing fallback cancellation restriction.
2. Add regression tests for those specific workflows on PostgreSQL, including an online sale followed by an outage and an offline register close.
3. Add damaged-return disposition, purchase duplicate protection, consistent drawer payouts and historical invoice identity. Make costing/report labels explicit.
4. Complete a clean CI run and test a packaged desktop on actual scanner/printer hardware. Restore a backup onto a fresh machine and reconcile stock, wallets, receivables, payables and drawer totals.
5. Pilot in a defined shop segment, then prioritize stocktake, promotions, purchasing and payment reconciliation from that segment's needs.

Do not start all missing features at once. The existing functional coverage is sufficient to build on; reliable money, stock and outage behavior is the immediate release work.
