# Fix Plan: Security, Business Logic and Code Quality

This plan comes from two code reviews done on 2026-10-02: a full-codebase review and a review of commit 59a0213 ("Protect POS drafts on navigation").
Work through the phases in order. Each item lists where the problem is, what goes wrong, and the planned fix.

## How to use this file (for a new session)

1. Read this file, then the **Progress log** at the bottom.
2. Pick the first unchecked item. **Confirm the problem in the code before fixing it**: the line numbers come from review notes, may have shifted, and a few findings haven't been checked yet.
3. After a fix, run `pnpm --filter @pos/api typecheck` and `pnpm --filter @pos/web typecheck`, tick the box, and add a line to the Progress log saying what changed and anything left over.
4. Dependencies: `pnpm install` at the repo root, then `npx prisma generate` in `apps/api`.

Status key: `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` dropped (say why)

---

## Phase 1: Authentication and access (do first)

### [x] 1. Signed tokens, password hashing, no default accounts
- **Where:** `apps/api/src/pos/pos.controller.ts` `getSession`, `pos.service.ts` `buildToken` / `login` / `createUser` / `updateUser` / `onModuleInitSeed`
- **Problem:** The token was base64 of `userId:role:branchId:registerId`, with no signature and no expiry, and never checked against the database. Anyone could send `base64('<id>:ADMIN')` and get admin rights. Passwords were stored and compared as plain text, and startup created `admin`/`password` and `cashier`/`password`.
- **Fix:**
  - The token is now `base64url(payload).base64url(HMAC-SHA256)`, signed with `AUTH_SECRET` and expiring after `AUTH_TOKEN_TTL_HOURS` (default 12). Code: `apps/api/src/auth/token.ts`.
  - A global `AuthGuard` (`apps/api/src/auth/auth.guard.ts`) re-checks the database on every request. The user must exist and be active, the token's role must match the database, the user must still have access to the token's branch, and the token's register must still be open. Routes marked `@Public()` (only login) skip the guard.
  - Passwords are hashed with scrypt (`apps/api/src/auth/password.ts`). At startup, any plain-text passwords still in the database are hashed.
  - The seed creates an admin only when there are no users at all. The password comes from `SEED_ADMIN_PASSWORD`, or a random one is printed once. No cashier is seeded. Startup logs a warning for any user whose password is still `password`.
  - Web: on a 401, the session is cleared and the user is sent to `/login`.
- **Follow-ups (not done):** limit repeated login attempts; let admins force a password reset; move the token to an httpOnly cookie instead of localStorage; the three raw `fetch` uploads (`BranchSettingsPage.tsx` business/branch logo, `ItemsPage.tsx` item image) skip the 401 redirect in `api.ts`, so route them through a shared helper.

### [x] 2. Check which branch a record belongs to on every endpoint that takes an id
- **Where:** `pos.controller.ts` around line 566. These routes take an id but never check its branch: `GET /sales/:id`, `GET /receipts/:id`, `GET /receipts/by-invoice/:id`, `GET /customers/:id/wallet`, `POST /customers/:id/wallet/topup`.
- **Problem:** Staff at branch A can read branch B's invoices, receipts and wallets, and an admin can top up branch-B wallets.
- **Fix:** Pass `session.branchId` into each service method and add `branchId` to the `where` clause (return 404 if it doesn't match). Then check every other `:id` route for the same gap.

### [x] 3. Validate request data on the server
- **Where:** `apps/api/src/main.ts:10`. `ValidationPipe` does nothing because request bodies are typed inline, not as DTO classes. The zod schemas in `packages/contracts` are never applied on the API.
- **Problem:** Negative or NaN amounts reach the service methods. For example, `POST /customers/:id/wallet/topup {amount:-5000}` drains a wallet. This is the root cause of #6 and #7.
- **Fix:** Apply the contract's zod schemas on the server, either with `@ts-rest/nest` (best, since the web app already uses ts-rest) or a small `ZodValidationPipe` per route. Tighten the schemas: amounts must be positive and finite, quantities greater than 0, and the arrays inside payloads non-empty with no duplicates.

### [x] 4. Sanitise branch receipt CSS
- **Where:** The web receipt renderer puts the branch's custom CSS raw into a `<style>` tag.
- **Fix:** Remove `</style`, `@import`, `url(javascript:` and similar on save (server) and on render. Better still, limit it to a set of allowed properties.

## Phase 2: Money correctness (server decides the numbers)

### [x] 5. Server-side pricing
- **Where:** `pos.service.ts` around line 1495 (`createSale`)
- **Problem:** `rate`, `taxRate`, `taxMode` and `saleUomConversionQty` are taken straight from the request, so a ₹5,000 item can be sold for ₹0.01 at 0% tax.
- **Fix:** Look up the item, its `ItemSaleUom` rows and its MRP inside the transaction. Work out the rate, tax and conversion on the server. Accept a lower rate only within an allowed price-override or discount policy, and record who overrode it.

### [ ] 6. Tax-inclusive rounding goes over MRP
- **Where:** `pos.service.ts` around line 711. The web app has the same maths in `PosPage.tsx`.
- **Problem:** MRP ₹100 at 18% inclusive gives pre-tax 84.75 + tax 15.26 = **₹100.01**.
- **Fix:** Round the pre-tax amount, then set `tax = gross − base` so `base + tax` always equals the shelf price. Fix both copies, or do #16 first.

### [ ] 7. Settling a sale / wallet payments
- **Where:** `pos.service.ts` around line 1660 (`settleSale`)
- **Problem:**
  - Only the first WALLET payment line is checked and debited (`payments.find`), so `[{WALLET,0},{WALLET,1000}]` settles a ₹200 bill and credits ₹800 to the wallet.
  - Negative amounts are accepted.
  - Invoices that are already SETTLED or CANCELLED can be paid again.
- **Fix:** Add up all WALLET lines and check the total against the balance. Reject amounts that are ≤ 0 or not finite. Allow settling only from DRAFT. Decide what to do with overpayment: give change for cash, and reject it for other payment methods unless credited to a wallet on purpose.

### [ ] 8. Return quantity can be counted twice
- **Where:** `pos.service.ts` around line 1809 (`createReturn`)
- **Problem:** Repeated `saleLineId`s within one request aren't added up before the "already returned" check. Unpaid DRAFT invoices can be returned for a CASH refund.
- **Fix:** Group the lines by `saleLineId` first. Allow returns only on SETTLED invoices. Don't refund more than was paid; for credit sales, refund to the customer's wallet or reduce what they owe.

### [ ] 9. Stock can go negative
- **Where:** `pos.service.ts` around line 1491 (`createSale`), `openRegister`, and stock adjustment OUT
- **Problem:** Each line is checked against stock separately, even when two lines are the same item, and nothing locks the stock between the check and the write. Two registers can both sell the last unit, and two registers can open at once.
- **Fix:** Add up base-unit quantities per item before checking. Do the check and the write in one transaction that locks the rows (`SELECT ... FOR UPDATE` on an item stock row), or use Serializable isolation with a retry. For registers, add a partial unique index on `RegisterSession(branchId) WHERE closedAt IS NULL`.

### [ ] 10. Create and pay a sale in one step
- **Where:** `apps/web/src/screens/PosPage.tsx` around line 1494. Checkout makes two calls: create the sale (stock deducted as DRAFT), then settle it.
- **Problem:** If payment fails, the DRAFT invoice keeps the stock. A retry deducts it again, and reports count both invoices.
- **Fix:** Add a `POST /sales/checkout` endpoint that creates and settles in one transaction, with an idempotency key generated by the web app so a retried request can't create a second invoice. Add a job, or an admin action, to cancel DRAFT invoices left over from the old flow and put their stock back.

## Phase 3: Reports and register

### [ ] 11. Fix "profit" in reports
- **Where:** `pos.service.ts` around line 2019
- **Problem:** Gross sales include GST, and every opening-stock or stock-adjustment-in entry is subtracted as an expense. Loading ₹1 lakh of stock shows a ₹1 lakh loss that day.
- **Fix:** Report net sales (excluding tax), tax collected, returns, and cost of goods sold (the item's cost price or average cost at the time of sale, stored on the sale line). Gross profit = net sales − cost of goods sold. Count only SETTLED invoices.

### [ ] 12. Balance the register at close
- **Problem:** Payments and refunds aren't linked to a register, so the expected cash in the drawer can't be worked out.
- **Fix:** Add `registerSessionId` to payments and refunds. At close, show expected cash (opening balance + cash sales − cash refunds), what was counted, and the difference. Save the difference.

### [ ] 13. Customers from other branches
- **Problem:** `listCustomers` returns customers from every branch, but `createSale` rejects customers from another branch.
- **Fix:** Decide the business rule (are customers shared or per branch?) and apply it the same way in both places.

### [ ] 14. Shared walk-in wallet
- **Problem:** All walk-in customers share one wallet, yet returns can refund into it.
- **Fix:** Turn off wallet refunds and wallet payments for the walk-in customer, and refund cash or the original payment method instead.

### [ ] 15. Report dates use the server's time zone
- **Fix:** Add a `timezone` setting (branch or business, default `Asia/Kolkata`) and work out "Today", "This Week" and "This Month" in that zone.

## Phase 4: Code quality

### [ ] 16. Share the pricing maths
- Move the discount and tax line calculation into one shared package (for example `packages/pricing` or `packages/contracts`) used by both `PosPage.tsx` and `pos.service.ts`, with unit tests (the ₹100.01 case, multiple discounts, conversions between units).

### [ ] 17. Remove stale build files
- `packages/contracts/src/index.js` and `index.d.ts` are compiled leftovers (no `saleUoms`). Delete them and add them to `.gitignore`.

### [ ] 18. Faster stock-on-hand lookups
- Stock on hand is recalculated from the full stock history each time. Add an `ItemStock` table (item, branch, qty) updated in the same transaction as each stock entry. This row is also what #9 locks.

### [ ] 19. Split up the big files
- `pos.service.ts` (2000+ lines) and `pos.controller.ts` handle everything. Split them into modules (auth, users, items, sales, returns, customers, registers, reports). `PosPage.tsx` should likewise be broken into hooks and components.

### [ ] 20. Add tests
- There are no tests. Start with service-level tests for pricing, settling sales, returns and stock, the money paths fixed in Phase 2.

## Phase 5: POS draft handling (from the review of commit 59a0213, all in `apps/web/src/screens/PosPage.tsx`)

### [ ] 21. A paid cart can stay saved as a draft (around line 1288)
- If the user leaves or refreshes during an in-flight checkout, the cart is saved as a draft with a new id. `onSuccess` only removes the old `activeDraftId`, so the paid cart remains and can be billed again. **Fix:** Don't block or auto-save while `checkout.isPending`, and remove the draft whose id is in the latest state (use a ref), not the id captured when checkout started.

### [ ] 22. Logout and Close Register break if the leave prompt is cancelled (around line 1279)
- The native `beforeunload` prompt appears after `clearSession()` or the register close has already run. **Fix:** Turn the blocker off (with a ref flag) before setting `window.location.href`, or navigate with the router instead.

### [ ] 23. No "leave without saving" option (around line 1282)
- **Fix:** Use a custom dialog with three choices: Save draft / Discard / Stay.

### [ ] 24. Emptying a resumed draft doesn't discard it (around line 1240)
- **Fix:** In `backToOrders`, when the cart is empty and `activeDraftId` is set, remove that draft.

### [ ] 25. Auto-save overwrites other tabs' drafts (around line 1302)
- **Fix:** Read the latest drafts from localStorage before writing, and listen for the `storage` event to keep each tab in sync.

### [ ] 26. A failed storage write after checkout keeps the paid draft (around line 1583)
- **Fix:** Use the functional form of `setLocalDrafts`, and show an error if the write fails.

### [ ] 27. Tablets often don't fire `beforeunload` (around line 1310)
- **Fix:** Also save on `pagehide` and on `visibilitychange` when the page becomes hidden.

### [ ] 28. `beforeunload` registered twice, listener re-added on every cart change (around line 1297)
- **Fix:** Keep one listener that calls the latest save function through a ref.

### [ ] 29. Unneeded branch in `saveCurrentCartAsLocalDraft` (around line 1209)
- **Fix:** Replace it with `[draft, ...localDrafts.filter(d => d.id !== draft.id)].slice(0, 20)`.

---

## Progress log

- **2026-10-02:** Created this plan and finished #1 in code: signed tokens, a guard that re-checks the database on every request, scrypt hashing, a seed with no fixed password, and a web redirect on 401.
  - Changed: `apps/api/src/auth/{token,password,auth.guard}.ts` (new), `pos.controller.ts` (`getSession` now checks the signature; login is `@Public()`), `pos.service.ts` (hashing in login/createUser/updateUser, `seedFirstAdmin`, `hashPlaintextPasswords`), `app.module.ts` (global `APP_GUARD`), `main.ts` (loads `.env` with `process.loadEnvFile`, which needs Node 20.12 or later; fails at startup if `AUTH_SECRET` is missing), `.env.example`, `apps/web/src/lib/api.ts` (on 401, clears the session and goes to `/`).
  - New passwords must be 8–128 characters. Existing short passwords still work until they're reset.
  - Verified: both apps type-check, and a script checked the token and password helpers (tampered, expired, old-format and wrong-secret tokens are rejected; hashing and verifying work).
  - **Not yet tested with a running app**, because Postgres wasn't running. Still to check: the API starts; on first startup plain-text passwords are hashed (look for the `default password` warning); login works; a token with a closed register or a deactivated user gets a 401; the web app redirects to login.
  - Before running: `AUTH_SECRET` is needed in `apps/api/.env`. A random one was added to the local `.env`; on other machines, copy `.env.example`. Everyone is signed out once, because old tokens are rejected.
- **2026-10-02 (session 2):** Tested #1 with the app running and marked it done. Nothing in the code needed changing.
  - Setup used: Postgres 16 (`service postgresql start`, user `postgres`/`postgres`, database `pos_db`), `apps/api/.env` copied from `.env.example` with a generated `AUTH_SECRET`, `npx prisma migrate deploy`. The web app needs `pnpm --filter @pos/types --filter @pos/contracts build` first: Vite resolves `@pos/contracts` through `dist/`, which isn't committed.
  - API, fresh database: the first admin was created with a random password printed once; no cashier was seeded; passwords are stored as `scrypt$…`.
  - API, requests: login works, and a wrong password gets 400. With no token, an old-style `base64('x:ADMIN')` token, or a token whose payload was edited, the request gets 401. Each of these also gets 401: a token after the user is deactivated (logging in again gets 400 "Account is inactive"), a token after the user's role changes in the database, and the register token after `/registers/close` (close returns a new token, and that one works). A cashier calling an admin route gets 400 "Admin role required". A new user's password must be at least 8 characters.
  - API, restart with plain-text users added: both were hashed at startup, the `default password` warning was logged for the user whose password was `password`, and both can still log in with their old passwords.
  - API, startup config: it refuses to start when `AUTH_SECRET` is empty or shorter than 32 characters. Note: the Prisma client also loads `apps/api/.env` when imported, so `AUTH_SECRET` is still set even when the process is started from another directory.
  - Web (Playwright): after logging in, the app goes to `/open-register`. After the user is deactivated in the database and the page is reloaded, the API returns 401, the session is cleared, and the login form is shown.
- **2026-10-02 (session 2):** Finished #2. Five service methods now take the session's branch: `getSaleById`, `getReceiptById`, `getReceiptsByInvoice` (both the invoice-id and invoice-number lookups), `getWallet` and `topupWallet`. Each adds `branchId` to its `where`, so a record from another branch returns 404 as if it didn't exist.
  - Checked the other `:id` routes; none needed changes. Settle, return, `GET /returns/:id` and `PATCH /customers/:id` already check the branch, and `createSale` checks the customer's branch. Items have no branch. The admin-only branch and user routes skip the check when no branch is selected. That's by design: `createBranch` gives every admin access to every branch, so admins work across the whole business.
  - Tested with the app running (two branches): from branch A, all six requests succeed. From branch B, the same requests for branch A's records all return 404, including a ₹5,000 wallet top-up, and the wallet balance stays the same.
- **2026-10-02 (session 2):** Finished #3. Every route that takes a request body now validates it against the matching `@pos/contracts` schema, using a small `ZodValidationPipe` (`apps/api/src/validation/zod-validation.pipe.ts`), e.g. `@Body(new ZodValidationPipe(appContract.sales.create.body))`. Invalid requests get a 400 that lists each problem (`lines.0.qty: Number must be greater than 0`). Unknown keys are dropped.
  - Chose the pipe over `@ts-rest/nest`: it applies the same schemas without rewriting every controller method. Switching later is still possible.
  - Tightened the schemas:
    - Sale `rate` must be 0 or more; `taxRate` must be 0–100 everywhere; a percentage discount can't be over 100.
    - Required text fields (names, codes, units, username, stock adjustment reason) must not be blank after trimming.
    - Passwords must be 8–128 characters on create and update.
    - Duplicates are rejected in return `saleLineId`s, user `branchIds` and item sale units.
    - Item `imageUrl` no longer has to be a full URL: the upload endpoint returns a relative `/uploads/...` path, which `.url()` would have rejected.
  - Removed the global `ValidationPipe` from `main.ts`. It did nothing, because the bodies aren't DTO classes.
  - Build fix: `apps/api/tsconfig.build.json` now clears `paths`. Before, the source mapping in `tsconfig.base.json` pulled `packages/contracts/src` into the API build, which moved the output to `dist/apps/api/src/...`, so `node dist/main.js` kept running an old build. The API now loads `@pos/contracts` from its built `dist` (an ES module, loaded with `require`), so it needs **Node 22.12 or later** (added `engines` to `apps/api/package.json`). Build the packages first: `pnpm --filter @pos/types --filter @pos/contracts build`, or use `pnpm build`, which turbo orders.
  - Tested with the app running: 24 invalid requests get 400, including a -5000 wallet top-up, a 0 or missing amount, `1e999`, qty 0 or negative, negative rate, 150% tax, no sale lines, a 120% discount, an empty reason, duplicate sale units, branches or return lines, a short password, a blank name, negative register balances, and settling with a negative amount, no payments or an unknown mode. Valid requests still succeed (top-up, return, customer and item updates), and the branch checks from #2 still pass. A full checkout through the web UI (Playwright) also succeeded.
  - What this covers from later items: #7's negative and zero payments are now rejected, and #8's repeated return lines are rejected. The rest of #7 and #8 is still open: several separate WALLET payment lines, settling an invoice that's already paid, and returns on unpaid invoices.
  - Query strings and path params are validated too:
    - The 7 routes with a query string use the contract's `query` schema. This fixed two crashes: `GET /reports/sales-summary` and `GET /users` without `branchId` used to return 500 and now return 400.
    - `items.list`'s `activeOnly` used `z.coerce.boolean()`, which turned `"false"` into `true`. It now accepts `true`/`false` or `"true"`/`"false"`.
    - Every `:id`-style path param uses Nest's `ParseUUIDPipe`, so a malformed id gets 400. The exception is `/receipts/by-invoice/:invoiceId`, which also accepts an invoice number.
- **2026-10-02 (session 2):** Finished #4. Branch invoice and receipt CSS goes through a shared sanitizer, `sanitizeReceiptCss` in `packages/contracts/src/receiptCss.ts`, used by both the API and the web app.
  - What it keeps:
    - Only plain rules and `@media` blocks; every other at-rule (`@import`, `@font-face`, ...) is dropped.
    - Every selector is scoped to `#printable-invoice`, and a leading `body`/`html`/`:root` points at the receipt instead. Attribute selectors and sibling combinators (`~`, `+`) are rejected.
    - Only allowlisted properties (typography, colour, spacing, borders, sizes, flex) plus `--receipt-*` variables.
    - Values can't contain `url(`, `expression(`, `image(`, `attr(`, `:`, `;`, braces, `<`, `\` or `@`.
    - The output is rebuilt from the parsed pieces, so `</style>` can't get through.
  - On save: the `branches.update` contract rejects CSS that the sanitizer would change, plus anything over 10,000 characters. The admin sees the reasons, because the Branch Settings page now shows the API's message (`apiErrorMessage` moved from `ItemsPage` to `lib/api.ts`).
  - On render: the POS, Sales and Returns pages and the downloaded invoice HTML use only the sanitized CSS. That covers CSS saved before this fix. The invoice number in the downloaded file's `<title>` is HTML-escaped.
  - Also fixed:
    - `resolveReceiptWidth` used `\\s`/`\\d` in a regex literal, so `--receipt-ch: 32` never matched and the receipt width setting didn't work.
    - Branch codes and invoice, receipt and return prefixes accepted any text. They're now 1–16 letters, digits, `-` or `/`. A branch whose saved prefix breaks this rule can't be saved until it's changed.
    - `@pos/contracts` is now `"type": "module"`, so Node doesn't warn when it loads the second file.
  - Tested with the app running:
    - The API rejected a `</style><script>` breakout, `@import`/`url()`, attribute selectors, `position: fixed` overlays, CSS over 10,000 characters, and prefixes with markup or spaces. Valid CSS and `INV/26` were saved.
    - In the browser, with malicious CSS written straight into the database, the script didn't run, `aside { display: none }` didn't hide the app, nothing was fetched from the attacker host, and the legitimate rules still applied (`--receipt-ch: 32`, colour). The downloaded invoice had no script, and its title was escaped.
    - The settings page showed the rejection reasons. The Sales and Returns pages loaded with no console errors.
    - The earlier suites (validation, branch checks, UI checkout) still pass.
- **2026-10-02 (session 2):** Finished #5. The user chose the policy: a cashier limit, admins unlimited.
  - `createSale` now works out each line from the item (`resolveLinePricing`):
    - The tax rate and tax mode come from the item. The request must send the same values; otherwise it gets 400 "Tax for X has changed. Refresh and try again." This catches stale POS screens before the cashier collects the wrong amount.
    - The sale unit must be one of the item's units, and its conversion comes from the database. A mismatched size or unknown unit gets 400, and the stock quantity is checked against boxes × conversion.
    - The list price is `item.sellPrice`, or the sale unit's `sellPrice`. The request's `rate` is accepted only at or below list price, for everyone.
    - Inactive items can't be sold.
  - Cashier limit (`assertWithinCashierDiscountLimit`): price changes, item discounts and the order discount together may lower the sale by at most `BusinessSettings.cashierMaxDiscountPercent` (default 10). It's measured on the whole sale, before tax, against list price, with one paisa of slack for rounding. Over the limit gets 400 "...take X% off this sale; cashiers can give at most N%. Ask an admin." Admins have no limit. Because the limit covers the whole sale, a cashier can still give a big discount on one cheap line inside a larger sale.
  - Migration `20261002102325_sale_pricing_policy`: adds `BusinessSettings.cashierMaxDiscountPercent` (default 10) and `SaleInvoiceLine.listRate` (null on older lines). A changed price shows as `rate < listRate`; the user is the invoice's `createdBy`.
  - Web:
    - The Business Settings tab has a "Cashier discount limit (%)" field (0–100, checked in the form and in the contract).
    - POS checkout now shows the API's error message instead of "Failed to create invoice".
    - The POS still sends `rate`, `taxRate` and so on; the server checks them.
  - Moved `exclusiveBase` and `pricingQty` out of `calculateSaleTotals`, so the limit uses exactly the same maths.
  - Tested with the app running (23 API checks):
    - As cashier, rejected: a ₹0.01 price on a ₹5,000 item, tax 0% or INCLUSIVE sent for an 18% EXCLUSIVE item, a price above list, the wrong box size, an unknown unit, an inactive item, a 15% order discount, and 8% price cut + 4% discount.
    - As cashier, accepted: exactly 10% off (stored rate 4500, listRate 5000, total 5310), 9.84% made of discounts, a box at list price (qty 10), and a tax-inclusive item (total 100).
    - Limit setting: 20% lets the 15% discount through; a cashier can't change the limit; -1 and 101 are rejected.
    - As admin: ₹0.01 accepted with `listRate` recorded; above list price and wrong tax still rejected.
    - In the browser, the cashier saw the limit message when the price was rewritten to ₹0.01. The settings field loads, rejects "abc", and keeps 15 after a reload. The earlier suites and the UI checkout still pass.
