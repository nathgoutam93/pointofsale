# Pre-launch audit

Written 2026-10-04 from an audit of the codebase (billing logic, code patterns and fitness as a
retail shop's billing software). **Everything here must be done before launch**, alongside the
open items in `remaining-work-plan.md`. Each item says why it matters, what to do and when it's
done. Tick items off here and add a line to the progress log at the end.

The core money and GST maths (`packages/contracts/src/pricing.ts`, GSTR-1/3B, counter document
series, stock locking, register balancing) is solid and well tested. What follows is what
stands between that and a shop using it as its only billing software.

Paths are as of version 0.1.3; check them first, as they may have moved. Keep the suites green:
`pnpm --filter @pos/api test`, `pnpm --filter @pos/contracts test`, `pnpm -r typecheck`.

---

## A. Business logic: money, tax and fraud

### [x] A1. UPI as a payment mode

- **Why:** `PaymentMode` is `CASH | CARD | WALLET` (`apps/api/prisma/schema.prisma`). UPI is
  the main way Indian retail customers pay; today it is rung up as Card, so card settlement and
  UPI collections can't be reconciled.
- **What:**
  - Add `UPI` to `PaymentMode` (migration), the contracts' payment schemas and the POS payment
    dialog (`apps/web/src/screens/pos/usePayment.ts`, `PaymentModal.tsx`), with an optional
    reference (UTR).
  - Receipts, the sales register CSV, statements, offline (fallback) checkout and sync accept it.
  - Optional later: show a UPI QR (payee VPA in Branch Settings, amount filled in).
- **Done when:** a sale can be paid by UPI (alone or split with cash), it prints as UPI, and the
  register close and reports show UPI separately from card.
- **Status (2026-10-04):** `UPI` payment mode (migration `20261020100000_upi_payment_mode`) on
  checkout and settling, POS and Sales screens; receipts print "Paid by UPI"; the register (and
  the close dialog) shows card and UPI taken apart from cash (`registerCash`, `register.test.ts`).
  Left for later: a UTR/reference field in the payment dialog, UPI QR, refunds to UPI.

### [x] A2. Wallet top-ups leave a money trail

- **Why:** `CustomersService.topupWallet` (`apps/api/src/customers/customers.service.ts`) only
  raises the balance: no payment mode, no register, no user (`WalletTxn` has no user field).
  - A cashier with `TOP_UP_WALLETS` can create balance with no money taken, then spend it.
  - Cash really taken for a top-up isn't in the register's expected cash, so the drawer is "over".
- **What:**
  - A top-up needs an open register and a payment mode (cash, card, UPI); cash top-ups count in
    `RegistersService.registerCash`.
  - Record who did it on `WalletTxn` (`createdBy`, `createdByName`) and print a top-up receipt.
  - Manual corrections go through the existing `ADJUSTMENT` type, admins only, with a reason.
- **Done when:** every wallet credit names a user, a register and how it was paid, and a cash
  top-up shows up in the drawer's expected cash.
- **Status (2026-10-04):** top-ups need an open register (at its branch) and a mode (cash, card,
  UPI); `WalletTxn` records `createdBy`/`createdByName`, `paymentMode`, `registerSessionId` and
  `reason` (migration `20261020110000_wallet_txn_trail`), including the entries sales and returns
  make. Cash top-ups count in the drawer's expected cash (`cashTopups`), card and UPI ones in the
  card and UPI takings. Admins correct balances with `POST /customers/:id/wallet/adjust` (reason
  required, never below 0), shown on the Customers page. Refused while working offline. Tests:
  `wallet.test.ts`. Left for later: a printed top-up receipt.

### [x] A3. Controls on returns and cash refunds

- **Why:** any cashier with an open register can return any bill of the branch, of any age, and
  hand out cash (`apps/api/src/returns/returns.controller.ts`, `POST /sales/:id/return`). No
  permission, reason, approval or time window; `ReturnInvoice` doesn't record who made it (only
  the register session). Fake refunds are the commonest till fraud.
- **What:**
  - A `MAKE_RETURNS` cashier permission (admins always), in `CashierPermission` and Settings →
    Cashiers & Access.
  - A required reason on each return; `createdBy` / `createdByName` on `ReturnInvoice`.
  - A business setting for the return window in days; past it, only admins.
  - Optional: refunds above an amount need an admin's password at the counter.
  - Offline (fallback) returns follow the same rules.
- **Done when:** a cashier without the permission, or past the window, can't make a return, and
  every credit note shows who made it and why.
- **Status (2026-10-04):** `MAKE_RETURNS` cashier permission (existing cashiers were given it by
  migration `20261020120100_return_permission_for_cashiers`, so nothing changes for them until an
  admin takes it away; new cashiers start without it). Each return needs a reason and records
  `createdBy`/`createdByName`, shown on the Returns page. Settings has a return window
  (`returnWindowDays`, calendar days in the business time zone, empty for no limit); past it
  only admins. The fallback counter's local API applies the same rules from its copy. Tests:
  `return-controls.test.ts`. Left for later: an admin's password at the counter for large refunds.

### [x] A4. Credit sales can't be cancelled like abandoned bills

- **Why:** a credit sale is saved as `DRAFT` with nothing paid, which is exactly what
  `SalesService.cancelSale` allows (`apps/api/src/sales/sales.service.ts`). A cashier with
  `CANCEL_SALES` can cancel a credit bill months later: the receivable disappears, stock comes
  back and a GSTR-1 already filed changes.
- **What:**
  - Separate the two meanings: a credit sale gets its own status (e.g. `ON_CREDIT`, or
    `PARTIALLY_SETTLED` with nothing paid) instead of `DRAFT`. Migrate existing rows (DRAFT
    invoices of non-walk-in customers created by checkout).
  - Cancelling an issued tax invoice is allowed only the same day (business time zone) and only
    for admins; after that the way out is a return (credit note).
  - Reports, ageing, statements and GSTR-1 follow the new status.
- **Done when:** a credit bill from an earlier day can't be cancelled, only returned, and no
  filed period changes.
- **Status (2026-10-04):** done without a new status. Any unpaid bill (abandoned or credit) can
  be cancelled only on the calendar day it was made (business time zone), by admins and cashiers
  with `CANCEL_SALES`; after that the server answers "make a return instead". Cancelling needs a
  reason and records `cancelledAt`, `cancelledBy`, `cancelledByName`, `cancelReason` (migration
  `20261020130000_sale_cancellation`), shown on the Sales page. A same-day cancellation stays in
  the same GST period. A separate status for credit sales (so `DRAFT` means only "abandoned") is
  still worth doing for clarity, but nothing depends on it now. Tests: `checkout.test.ts`.

### [ ] A5. Remove (or fix) "tax before discount"

- **Why:** with `taxCalculationMode = BEFORE_DISCOUNT` (`lineTax` in
  `packages/contracts/src/pricing.ts`), ₹100 at 18% with 10% off saves taxable ₹90 and tax
  ₹18, an effective 20%. GST is charged on the value after a discount shown on the invoice
  (CGST Act s.15(3)), and GSTR-1 then carries tax that doesn't match rate × taxable value.
- **What:** have a tax adviser confirm; then remove the option (migrate businesses using it to
  `AFTER_DISCOUNT`, from the next sale on) or restrict it to a compliant meaning.
- **Done when:** every saved line's tax equals its rate × taxable value (within a paisa), and
  a test says so.

### [x] A6. Never sell above MRP

- **Why:** item, sale-unit and branch prices accept any MRP; the server only checks rate ≤ list
  price (`resolveLinePricing`), not list price ≤ MRP. Selling above MRP breaks the Legal
  Metrology rules.
- **What:** when an MRP is set (> 0), reject a sell price above it on items, sale units and
  branch prices (`apps/api/src/items/items.service.ts`, contracts schemas), and reject a sale
  line above it. Show existing items that break the rule so the owner can fix them.
- **Done when:** no price path can save or bill above MRP, with tests.
- **Status (2026-10-04):** MRP includes GST, so the check is on what the customer pays: a
  tax-exclusive price with GST added (not while the business is a composition taxpayer, which
  charges none). `priceWithTax` / `mrpProblem` in `packages/contracts/src/pricing.ts` are used
  by item create and update (including tax changes and the branches' own prices), branch prices
  and every sale line. An MRP of 0 means none is printed; the API now stores 0 when no MRP is
  sent (it used to copy the pre-tax price, which would fail the check). The Items page warns in
  the form and marks items "Above MRP"; such items can't be billed until fixed, so check the list
  after deploying. Demo seeds set MRP with GST. Tests: `mrp.test.ts`, `pricing.test.ts`.

### [x] A7. The server re-checks offline sales instead of trusting them

- **Why:** `FallbackService.sync` (`apps/api/src/fallback/fallback.service.ts`) inserts the
  fallback computer's rows as sent. Series, branch and references are checked, but not totals,
  tax, discounts, the cashier discount limit or the stock movements' quantities. Anyone who edits
  the local database on that computer can add made-up bills or stock.
- **What:** before inserting, recompute each invoice with `computeSaleTotals` from its lines and
  the item's tax as copied, check the totals, payments and status match, the cashier limit held,
  and each stock movement's quantity equals its line's (sale) or return line's (return).
  Mismatches are clashes for a person to look at, like the existing ones.
- **Done when:** a tampered outbox (changed total, extra stock in, price above list) is refused,
  with tests in `fallback.test.ts`.
- **Status (2026-10-04):** `apps/api/src/fallback/verify-outbox.ts` (pure) runs inside every
  sync. For each bill it works the amounts out again from its lines and discounts with
  `computeSaleTotals`, under either tax calculation mode. Recomputed amounts must agree within 5
  paise, because the outbox doesn't keep line order and order moves an order discount's last
  paise. Stored totals must equal the sum of their lines exactly. It also checks: no price above
  the line's list price, no GST under composition, the cashier discount limit (by the bill's
  author's role on the server), payments (cash/card/UPI, adding up to `paidTotal`, never above the
  total), status, and stock out equal to what was sold. Returns: the refund equals the lines,
  `totalAmount = dueAdjusted + refundAmount`, cash only, never more of a sale line (quantity or
  any tax part) than was sold counting the server's other returns, and stock in equal to what
  came back. Any problem is a clash and nothing is added. Tests: `fallback.test.ts` (tampered
  total, stock, payment mode and amount, price, refund, return stock) and `verify-outbox.test.ts`.
  Not checked against the server's item prices or MRP, which may have changed since the copy.

### [x] A8. Reports don't rewrite past periods

- **Why:** `ReportsService` (`apps/api/src/reports/reports.service.ts`) counts only SETTLED
  bills but dates them by `createdAt`. A credit sale paid later appears in the period it was
  made, so last month's figures change; today's figures leave out today's credit sales though
  their stock is gone.
- **What:** count a sale in the period it was made whatever its status (except cancelled), and
  report collections (payments by date and mode) as a separate figure.
- **Done when:** a closed period's sales figure doesn't change when a credit bill from it is
  paid.
- **Status (2026-10-04):** sales, cost of goods sold and returns count every bill that isn't
  cancelled, in the period it (or the return) was made. "Still owed" shows how much of those sales
  is unpaid. New `collections` per period (cash, card, UPI, wallet) is money taken in the period
  for bills of any date. It is shown on the Reports page under "Money collected", including for
  all branches. Tests: `reports.test.ts`, which pays a credit bill later and checks the sales
  don't move.

### [~] A9. Smaller fixes

- [x] Opening stock edits rewrite the ledger row in place, and round quantity to 2 places
      (`StockService.updateStockOpening`, `round2(currentOnHand - openingQty + qty)`). Record
      the change as an adjustment instead, and use `round3`.
      **Done:** the opening count can be corrected only until the item's stock has moved at that
      branch; after that the API asks for a stock adjustment (which has a reason). The 2-place
      rounding is gone. Test: `stock.test.ts`.
- [x] An admin can close another user's register (a cashier who left without closing).
      **Done:** `POST /registers/:id/close` (admins, branches they manage), counted or not
      (`closingBalance: null` keeps the expected cash and leaves the count empty); the user's
      sign-in on it ends. "Close it for …" on the Open Register screen. Test: `register.test.ts`.
- [ ] Returns at another branch of the business (when customers are shared), into that branch's
      stock and drawer.
      **Needs a decision:** a credit note belongs to the original invoice's GSTIN, and branches in
      other states have other GSTINs. Decide whether returns are allowed only between branches
      under the same GSTIN (simplest), and which branch's series numbers the credit note.
- [x] One rounding helper: `round2` exists in `contracts/pricing.ts`, `api/common/numbers.ts`
      and `gst/gstr1.ts` with different behaviour (`round2(1.005)` is `1`). Use one,
      paisa-exact (integer paise or a decimal library), everywhere.
      **Done:** `roundTo` / `round2` / `round3` in `packages/contracts/src/pricing.ts` round half
      away from zero on the number as written (by shifting its decimal digits, so `1.005` is
      `1.01`). The API, GST returns, offline verification, POS cart, receipts and Returns page
      all use it. Test: `pricing.test.ts`.

---

## B. Retail features a shop needs on day one

### [x] B1. Cash tendered and change

- **Why:** a walk-in can't pay more than the bill (`settleSaleInTx`, `usePayment.ts`), so ₹500
  for ₹487 is refused and the cashier works out change by hand. For named customers any extra
  silently goes to their wallet.
- **What:** the payment dialog takes cash tendered and shows change; the invoice records the cash
  applied (the drawer keeps the bill amount). For named customers, ask: change or wallet.
- **Done when:** ₹500 for ₹487 shows ₹13 change, the receipt prints tendered and change, and the
  drawer's expected cash is right.
- **Status (2026-10-04):** a cash payment can carry `tendered` (migration
  `20261020140000_cash_tendered`). Only the amount applied goes on the bill and in the drawer.
  The payment dialog records cash beyond what is due as tendered and shows "Change to give". A
  registered customer's extra cash goes back as change by default, or into their wallet with
  "Add to wallet". The done screen says "Give back ₹X change", and receipts (printed, reprinted,
  emailed) print "Cash tendered" and "Change". Checked in the real POS in Chromium (₹500 for ₹487
  → ₹13 change). Tests: `checkout.test.ts`, `receiptDocuments.test.ts`. Also fixed a duplicate
  UPI button left from A1.

### [ ] B2. Round-off to the rupee

- **Why:** Indian bills round the grand total to the nearest rupee; ours don't.
- **What:** a business setting (none, nearest ₹1, nearest ₹0.50), a `roundOff` amount on the
  invoice shown on the receipt, in `computeSaleTotals` so POS and API agree; GSTR-1 keeps the
  unrounded taxable value and tax.
- **Done when:** a ₹486.60 bill shows round-off +0.40 and ₹487.00, and returns refund correctly.

### [ ] B3. Selling when the stock count is wrong

- **Why:** a sale is refused if stock would go below zero (`createSaleInTx`). Shop stock records
  are rarely exact, so goods on the counter can't be billed.
- **What:** a business setting: block (today), or warn and allow (admins always, cashiers if
  allowed), with negative stock listed on the Stock page for correction.
- **Done when:** with "allow" on, a sale past stock goes through and the item shows as negative.

### [ ] B4. Barcodes

- **Why:** an item's only barcode is its code. Shops get several EANs for one product, and
  loose goods come with weighing-scale labels that carry the weight or price.
- **What:** an `ItemBarcode` table (many per item, unique across items, optional sale unit);
  POS lookup by any of them; weighing-scale barcode parsing (prefix, item digits,
  weight/price digits) set per business.
- **Done when:** two different EANs find the same item, and a scale label adds the right
  quantity.

### [ ] B5. Reports a shop owner uses

- **Why:** reports are Today / This Week / This Month / Overall, one branch at a time.
- **What:**
  - Any date range.
  - Day-end (Z) report per register and per day: sales, returns, collections by payment mode,
    cash expected and counted.
  - Item-wise and category-wise sales (quantity, value, margin), cashier-wise sales, and
    discounts given.
  - All branches together for admins.
  - CSV download of each.
- **Done when:** an owner can answer "what sold, who sold it, how was it paid" for any day or
  month without the CSV export.

### [ ] B6. Audit log

- **Why:** nothing records price changes, cancellations, permission changes or settings changes.
- **What:** an append-only `AuditEvent` (who, when, what, before / after) written by item
  price and tax changes, cancellations, returns, wallet adjustments, user and permission changes,
  and settings; a screen for admins.
- **Done when:** every action in the list leaves an entry an admin can see.

### [ ] B7. Purchases: input tax and suppliers

- **Why:** purchases record goods received but not their GST, so GSTR-3B's input tax credit is
  missing; there are no supplier accounts, payables or purchase returns.
- **What:** tax per purchase line (rate, CGST/SGST/IGST from the supplier's state), input tax in
  GSTR-3B; then suppliers, amounts owed, payments and purchase returns (debit notes).
- **Done when:** GSTR-3B shows eligible ITC from recorded purchases.

### [ ] B8. Decide on scope: batches and expiry, offers

- **Why:** without batch and expiry tracking the product doesn't suit pharmacies or much of
  grocery; without schemes (buy X get Y, combo prices, customer-group prices) many shops will
  miss them.
- **What:** decide which shop types the first release is for, and say so on the sign-up page.
  Build batch/expiry and offers if those shops are in scope.
- **Done when:** the decision is written here, and either the features exist or the sign-up
  page names the shop types it's for.

---

## C. Code health and scale

### [ ] C1. Paging on every list

- **Why:** `listSales`, `listReturns`, the stock ledger, items and customers return every row;
  the Sales and POS screens load them all; "Overall" in reports scans the whole table. A shop
  with 300 bills a day slows down within months.
- **What:** cursor paging and date filters on the list endpoints, search on the server for
  items and customers, paging in the Sales, Returns, Stock and Customers screens; an index on
  `SaleInvoice (branchId, createdAt)`.
- **Done when:** the Sales screen opens fast on a branch with 200,000 bills (seeded).

### [ ] C2. Fewer queries inside checkout

- **Why:** `createSaleInTx` makes several queries per cart line and per discount inside one
  interactive transaction, which Prisma ends after 5 seconds by default. A long cart on a remote
  database can fail.
- **What:** load items, branch prices and stock for all lines at once; `createMany` lines,
  discounts and allocations; set an explicit transaction timeout.
- **Done when:** a 100-line checkout against the hosted database takes well under the timeout.

### [ ] C3. Database connections on the hosted server

- **Why:** one Prisma client per business, 3 connections each, up to 100 cached
  (`apps/api/src/tenancy/tenant-clients.ts`): up to 300 connections against PostgreSQL's
  default 100, plus each client's memory. Dropping a cached client can break a checkout that is
  mid-transaction.
- **What:** PgBouncer in transaction mode in front of PostgreSQL (in the README's hosting steps);
  cache size and pool sized to the server; don't disconnect a client while it has requests in
  flight.
- **Done when:** a load test with 150 businesses selling at once runs without connection errors.

### [ ] C4. Uploads

- **Why:** image type is checked only from the browser-supplied MIME type (SVG passes); files
  are served publicly without `X-Content-Type-Options: nosniff`; the item-image permission check
  runs after the file is written; 16 upload files are committed although `.gitignore` excludes
  them.
- **What:** check the file's content (PNG, JPEG, WebP only), save with the right extension,
  send `nosniff`, check permission before saving, and `git rm --cached apps/api/uploads`.
- **Done when:** an SVG or a renamed HTML file is refused, and uploads are out of git.

### [ ] C5. Lint, web tests, contracts in controllers

- **Why:** the root `lint` script runs nothing; the web app has no tests; controllers retype
  every request body by hand instead of using the ts-rest contracts, so they can drift;
  permission failures answer 400 instead of 403 (`AccessService`).
- **What:** ESLint (typescript-eslint, react-hooks) in CI; unit tests for the POS cart and
  payment hooks and a Playwright smoke test (sign in, sell, return, close register); bodies typed
  from the contracts (or `@ts-rest/nest`); `ForbiddenException` for permissions.
- **Done when:** CI runs lint and the web tests, and controllers no longer declare body types.

### [ ] C6. Split the largest files

- **Why:** `packages/contracts/src/index.ts` (~1,960 lines), `SalesPage.tsx` (~1,500),
  `ItemsPage.tsx` and `BranchSettingsPage.tsx` (~1,200 each) and `apps/desktop/src/main.ts`
  (~1,040) are hard to review and change safely.
- **What:** contracts by domain (sales, items, customers, GST...); screens into sections as
  `screens/pos/` already is.
- **Done when:** no source file is over about 600 lines.

---

## Progress log

- 2026-10-04: List written from the codebase audit.
