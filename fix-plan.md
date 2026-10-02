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

### [x] 6. Tax-inclusive rounding goes over MRP
- **Where:** `pos.service.ts` around line 711. The web app has the same maths in `PosPage.tsx`.
- **Problem:** MRP ₹100 at 18% inclusive gives pre-tax 84.75 + tax 15.26 = **₹100.01**.
- **Fix:** Round the pre-tax amount, then set `tax = gross − base` so `base + tax` always equals the shelf price. Fix both copies, or do #16 first.

### [x] 7. Settling a sale / wallet payments
- **Where:** `pos.service.ts` around line 1660 (`settleSale`)
- **Problem:**
  - Only the first WALLET payment line is checked and debited (`payments.find`), so `[{WALLET,0},{WALLET,1000}]` settles a ₹200 bill and credits ₹800 to the wallet.
  - Negative amounts are accepted.
  - Invoices that are already SETTLED or CANCELLED can be paid again.
- **Fix:** Add up all WALLET lines and check the total against the balance. Reject amounts that are ≤ 0 or not finite. Allow settling only from DRAFT. Decide what to do with overpayment: give change for cash, and reject it for other payment methods unless credited to a wallet on purpose.

### [x] 8. Return quantity can be counted twice
- **Where:** `pos.service.ts` around line 1809 (`createReturn`)
- **Problem:** Repeated `saleLineId`s within one request aren't added up before the "already returned" check. Unpaid DRAFT invoices can be returned for a CASH refund.
- **Fix:** Group the lines by `saleLineId` first. Allow returns only on SETTLED invoices. Don't refund more than was paid; for credit sales, refund to the customer's wallet or reduce what they owe.

### [x] 9. Stock can go negative
- **Where:** `pos.service.ts` around line 1491 (`createSale`), `openRegister`, and stock adjustment OUT
- **Problem:** Each line is checked against stock separately, even when two lines are the same item, and nothing locks the stock between the check and the write. Two registers can both sell the last unit, and two registers can open at once.
- **Fix:** Add up base-unit quantities per item before checking. Do the check and the write in one transaction that locks the rows (`SELECT ... FOR UPDATE` on an item stock row), or use Serializable isolation with a retry. For registers, add a partial unique index on `RegisterSession(branchId) WHERE closedAt IS NULL`.

### [x] 10. Create and pay a sale in one step
- **Where:** `apps/web/src/screens/PosPage.tsx` around line 1494. Checkout makes two calls: create the sale (stock deducted as DRAFT), then settle it.
- **Problem:** If payment fails, the DRAFT invoice keeps the stock. A retry deducts it again, and reports count both invoices.
- **Fix:** Add a `POST /sales/checkout` endpoint that creates and settles in one transaction, with an idempotency key generated by the web app so a retried request can't create a second invoice. Add a job, or an admin action, to cancel DRAFT invoices left over from the old flow and put their stock back.

## Phase 3: Reports and register

### [x] 11. Fix "profit" in reports
- **Where:** `pos.service.ts` around line 2019
- **Problem:** Gross sales include GST, and every opening-stock or stock-adjustment-in entry is subtracted as an expense. Loading ₹1 lakh of stock shows a ₹1 lakh loss that day.
- **Fix:** Report net sales (excluding tax), tax collected, returns, and cost of goods sold (the item's cost price or average cost at the time of sale, stored on the sale line). Gross profit = net sales − cost of goods sold. Count only SETTLED invoices.

### [x] 12. Balance the register at close
- **Problem:** Payments and refunds aren't linked to a register, so the expected cash in the drawer can't be worked out.
- **Fix:** Add `registerSessionId` to payments and refunds. At close, show expected cash (opening balance + cash sales − cash refunds), what was counted, and the difference. Save the difference.

### [x] 13. Customers from other branches
- **Problem:** `listCustomers` returns customers from every branch, but `createSale` rejects customers from another branch.
- **Fix:** Decide the business rule (are customers shared or per branch?) and apply it the same way in both places.

### [x] 14. Shared walk-in wallet
- **Problem:** All walk-in customers share one wallet, yet returns can refund into it.
- **Fix:** Turn off wallet refunds and wallet payments for the walk-in customer, and refund cash or the original payment method instead.

### [x] 15. Report dates use the server's time zone
- **Fix:** Add a `timezone` setting (branch or business, default `Asia/Kolkata`) and work out "Today", "This Week" and "This Month" in that zone.

## Phase 4: Code quality

### [x] 16. Share the pricing maths
- Move the discount and tax line calculation into one shared package (for example `packages/pricing` or `packages/contracts`) used by both `PosPage.tsx` and `pos.service.ts`, with unit tests (the ₹100.01 case, multiple discounts, conversions between units).

### [x] 17. Remove stale build files
- `packages/contracts/src/index.js` and `index.d.ts` are compiled leftovers (no `saleUoms`). Delete them and add them to `.gitignore`.

### [x] 18. Faster stock-on-hand lookups
- Stock on hand is recalculated from the full stock history each time. Add an `ItemStock` table (item, branch, qty) updated in the same transaction as each stock entry. This row is also what #9 locks.

### [x] 19. Split up the big files
- `pos.service.ts` (2000+ lines) and `pos.controller.ts` handle everything. Split them into modules (auth, users, items, sales, returns, customers, registers, reports). `PosPage.tsx` should likewise be broken into hooks and components.

### [x] 20. Add tests
- There are no tests. Start with service-level tests for pricing, settling sales, returns and stock, the money paths fixed in Phase 2.

## Phase 5: POS draft handling (from the review of commit 59a0213, all in `apps/web/src/screens/PosPage.tsx`)

### [x] 21. A paid cart can stay saved as a draft (around line 1288)
- If the user leaves or refreshes during an in-flight checkout, the cart is saved as a draft with a new id. `onSuccess` only removes the old `activeDraftId`, so the paid cart remains and can be billed again. **Fix:** Don't block or auto-save while `checkout.isPending`, and remove the draft whose id is in the latest state (use a ref), not the id captured when checkout started.

### [x] 22. Logout and Close Register break if the leave prompt is cancelled (around line 1279)
- The native `beforeunload` prompt appears after `clearSession()` or the register close has already run. **Fix:** Turn the blocker off (with a ref flag) before setting `window.location.href`, or navigate with the router instead.

### [x] 23. No "leave without saving" option (around line 1282)
- **Fix:** Use a custom dialog with three choices: Save draft / Discard / Stay.

### [x] 24. Emptying a resumed draft doesn't discard it (around line 1240)
- **Fix:** In `backToOrders`, when the cart is empty and `activeDraftId` is set, remove that draft.

### [x] 25. Auto-save overwrites other tabs' drafts (around line 1302)
- **Fix:** Read the latest drafts from localStorage before writing, and listen for the `storage` event to keep each tab in sync.

### [x] 26. A failed storage write after checkout keeps the paid draft (around line 1583)
- **Fix:** Use the functional form of `setLocalDrafts`, and show an error if the write fails.

### [x] 27. Tablets often don't fire `beforeunload` (around line 1310)
- **Fix:** Also save on `pagehide` and on `visibilitychange` when the page becomes hidden.

### [x] 28. `beforeunload` registered twice, listener re-added on every cart change (around line 1297)
- **Fix:** Keep one listener that calls the latest save function through a ref.

### [x] 29. Unneeded branch in `saveCurrentCartAsLocalDraft` (around line 1209)
- **Fix:** Replace it with `[draft, ...localDrafts.filter(d => d.id !== draft.id)].slice(0, 20)`.

## Phase 6: GST compliance (regular and composition taxpayers)

Added 2026-10-02 after a design discussion; nothing here is built yet.

**Goal:** the admin can download GST return data (GSTR-1 JSON for regular taxpayers, CMP-08/GSTR-4 figures for composition) and upload or enter it on the GST portal. The app does **not** file returns itself.

**Decisions made:**
- Both taxpayer types are supported. The type is a business setting that can be changed later, with an effective date. Composition applies to every GSTIN under the same PAN, so it is set for the whole business, not per branch.
- Each invoice records the taxpayer type it was made under, so past invoices never change when the setting changes.
- Regular taxpayers can sell inter-state (IGST). Composition taxpayers cannot sell goods inter-state.
- B2B (buyers with a GSTIN) is out of scope for now. Every sale is B2C. The data model should leave room for B2B later.

**Assumptions to confirm before starting:**
- No items carry cess.
- Required HSN length (4 or 6 digits) depends on turnover. It becomes a business setting rather than a guess.
- The B2CL threshold (an inter-state B2C invoice above which it is reported individually) has changed recently. Check the current value and keep it in one constant.
- The GST rules in this phase come from a design discussion, not a legal review. Have a chartered accountant check one month of real output before anyone files with it.

### [x] 30. Taxpayer type setting
- **Where:** `BusinessSettings` (Prisma), `settings/` service and controller, admin settings screen, contracts.
- **Change:**
  - Add `taxpayerType` (`REGULAR` | `COMPOSITION`).
  - Add `compositionCategory`, which sets the rate: trader or manufacturer 1%, restaurant 5%, service provider 6%.
  - Add `taxpayerTypeEffectiveFrom`.
  - Keep a history of changes (a small `TaxpayerTypeChange` table) so a report period that spans a switch can tell which rules applied when.
- **On each `SaleInvoice`:** store `taxpayerType` and `documentType` (`TAX_INVOICE` | `BILL_OF_SUPPLY`), set at checkout.
- **Backfill:** existing invoices become `REGULAR` / `TAX_INVOICE`.

### [x] 31. Branch GSTIN, state and place of supply
- **Where:** `Branch` model and admin branch screen; `SaleInvoice`; the POS customer section.
- **Change:**
  - Each branch gets `gstin` and `stateCode`. Validate the GSTIN checksum, and check that its first two digits match the state code.
  - `BusinessSettings.gstNumber` becomes a fallback only.
  - Each sale stores `placeOfSupplyStateCode`. It defaults to the branch's state (an over-the-counter sale is intra-state). The POS lets the cashier set a delivery state when goods are shipped to another state.
- **Rule:** intra-state means CGST+SGST; inter-state means IGST. A composition business can't pick a different state: the API rejects it, and the POS hides the option.

### [x] 32. Item HSN, GST unit and supply type
- **Where:** `Item` and `ItemSaleUom` models; the item admin screen and import.
- **Change:**
  - Add `hsnCode`, validated against the length setting from the assumptions.
  - Add `uqc`, the GST unit code (NOS, KGS, BOX, ...). Map existing free-text units to codes, with an admin screen for any it can't map.
  - Add `supplyType` (`TAXABLE` | `NIL_RATED` | `EXEMPT` | `NON_GST`). A 0% item must say which one; they are reported separately.
- **Backfill:** existing items get `TAXABLE` (or `NIL_RATED` when the rate is 0) and an empty HSN. The return builder lists every sold item with no HSN, so the admin can fill them in before exporting.
- **Copied onto each sale line at sale time:** `hsnCode`, `uqc` and `supplyType`, the same way `listRate` is copied.

### [x] 33. Store the tax split on every sale line
- **Where:** `@pos/contracts` pricing (`computeSaleTotals`, `lineTax`), `SaleInvoiceLine`, the sales service.
- **Change:**
  - Store `cgstAmount`, `sgstAmount` and `igstAmount` per line next to `taxAmount`. Intra-state, CGST = round half down to the paisa and SGST = tax − CGST, so the two always add up to the tax (₹15.25 → 7.62 + 7.63).
  - (Done in #30: under composition, pricing charges no tax.)
  - The API and POS share this function, so both change together. Add tests for the split, odd paise, inter-state and composition.
- **Backfill:** old lines become intra-state, with CGST/SGST split the same way.

### [x] 34. Store taxable value and tax on return lines
- **Where:** `ReturnInvoiceLine`, the returns service, `returnLineRefund`.
- **Problem:** return lines store only the refund amount. Credit notes and the period's net B2C figures need the taxable value and the tax split.
- **Change:**
  - Prorate `taxableAmount` and the CGST/SGST/IGST amounts from the sale line, the same way the refund already is.
  - The last units returned take exactly what is left, so a line returned in parts adds back up to the sale line.
- **Backfill:** split stored refund amounts for existing returns using each sale line's ratio of taxable value to tax.

### [x] 35. Tax Invoice and Bill of Supply documents
- **Where:** `apps/web/src/screens/pos/receipt.ts`, the printable and downloadable invoice, and the Sales page reprint.
- **Change:**
  - Regular taxpayers: the title is "Tax Invoice". Show the branch GSTIN, place of supply when it differs from the branch state, HSN per line, and CGST/SGST or IGST totals.
  - Composition: the title is "Bill of Supply", with no tax lines and the required declaration ("composition taxable person, not eligible to collect tax on supplies").
  - Use the type stored on the invoice, never the current setting.

### [x] 36. Invoice numbers per financial year
- **Where:** `sequences/` and `Branch` invoice and return sequences.
- **Problem:** GST invoice numbers must be at most 16 characters and unique within a financial year. Today's numbers (`INV-MAIN-000526`) never restart.
- **Change:**
  - Restart the series each financial year (April to March, in the business time zone), for example `INV-MAIN-2627-0001`.
  - Check the 16-character limit when the admin saves a prefix.
  - Keep counts of issued and cancelled documents per series, for the document summary in GSTR-1.

### [x] 37. GSTR-1 export (regular)
- **Where:** a new `gst/` module in the API, and an admin "GST returns" screen.
- **Change:**
  - Pick a GSTIN and a period (monthly, or quarterly for small taxpayers).
  - Build the return's sections:
    - B2C small (net of returns, grouped by place of supply and rate)
    - B2C large (inter-state invoices above the threshold, one by one)
    - Credit notes for B2C large invoices
    - Nil, exempt and non-GST sales
    - HSN summary
    - Document summary
  - Only invoices marked `REGULAR` are included.
  - Show a preview and a list of problems to fix (missing HSN, bad GSTIN) before the JSON can be downloaded.
- **Verify:** import the JSON into the government's GST offline tool. The format changes from time to time, so record which version it was built against.

### [x] 38. GSTR-3B summary (regular)
- **Change:** a report of the sales figures for GSTR-3B:
  - Table 3.1: outward taxable, nil/exempt and non-GST, with tax by type.
  - Table 3.2: inter-state supplies to unregistered buyers, by state.
- **Limits:** input tax credit needs purchase bills, which this system doesn't record, so this is a report for the admin to copy from, not a complete return.

### [x] 39. CMP-08 and GSTR-4 figures (composition)
- **Change:**
  - **CMP-08 (quarterly):** turnover of `COMPOSITION` invoices net of returns, and tax at the composition rate split into CGST and SGST. It is only a few figures, so a report is enough.
  - **GSTR-4 (yearly):** the outward summary. Purchases aren't recorded, so as with 3B this is partial.
  - Check whether the portal accepts a JSON upload for GSTR-4 before building an export.
  - Warn the admin as the year's turnover nears the composition limit.

### Later (not in this phase)
- B2B: customer GSTIN and state, plus the B2B and B2B credit-note sections. E-invoicing (IRN) once turnover requires it.
- Cess.
- Recording purchases, for input tax credit and complete 3B and GSTR-4 returns.
- Filing directly through a GST Suvidha Provider.

**Order:** #30 to #34 first (data captured correctly at sale time), then #35 and #36, then the reports #37 to #39. Rough size: 3 to 4 weeks in total, most of it in #30 to #34 and their backfills.

---

## Phase 7: Multiple counters per branch

### [x] 40. Counters (tills) per branch, configured by admins
- **Problem:** A branch could have only one open register, owned by whoever opened it, so a second cashier in the same shop couldn't sell.
- **Change:**
  - A `Counter` per till (name, active flag), set up by admins under Settings → Branches. Each register session runs on a counter: at most one open register per counter, and a cashier runs one counter per branch at a time. Other counters in the branch can be open by other cashiers at once, each with its own cash drawer and close-out.
  - Every branch starts with "Counter 1" (existing branches get it in the migration, with their register history moved onto it). Counters are renamed or deactivated, never deleted; an open counter, or a branch's last active counter, can't be deactivated.
  - Invoice, receipt and credit-note numbering stay per branch (shared by its counters).

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
- **2026-10-02 (session 2):** Finished #6. The line tax maths now lives in one place, `packages/contracts/src/pricing.ts` (`exclusiveBase`, `lineTax`). The API (`calculateSaleTotals`) and the POS (`computeLineAmounts`, `computedCart`) both use it, so the screen and the invoice can't disagree. This is a first step towards #16.
  - Tax-inclusive lines: tax = tax-inclusive amount − taxable, instead of a separately rounded percentage.
    - No discount: the total is exactly the shelf price.
    - Discount, AFTER_DISCOUNT: the tax-inclusive amount shrinks in proportion (`gross × taxable / baseExclusive`).
    - BEFORE_DISCOUNT: tax = `gross − baseExclusive`, on the undiscounted price.
  - Tax-exclusive lines are unchanged.
  - Verified:
    - A sweep of every price ₹0.01–₹500 × rates 0.25/3/5/12/18/28% × qty 1/2/3/5 (1.2M lines). The old maths was a paisa off the shelf price in **105,834** cases; the new maths in **0**, in both tax modes. With a 10% discount the tax is never negative and the total stays between taxable and gross.
    - With the API running, ₹100 @18% now bills 84.75 + 15.25 = ₹100.00 (it was ₹100.01). Other reproductions (3×₹100, ₹99 @5%, 7×₹250 @12%, ₹1, ₹59 @28%) also match the shelf price.
    - In the browser, the POS showed "Taxes 15.25, Total 100.00", and the invoice was created and settled at ₹100.
    - The pricing, validation and branch suites and the UI checkout still pass.
  - Invoices already saved keep their stored amounts; returns use the stored line amounts.
- **2026-10-02 (session 2):** Finished #7. Reproduced first: a ₹5 wallet became ₹805 from one `[WALLET 1, WALLET 1000]` settle, a SETTLED invoice could be paid again (its payment went into the wallet, getting around the admin-only top-up), and 5 concurrent settles of one invoice wrote 5 payment rows.
  - `settleSale` now:
    - Locks the invoice row (`SELECT ... FOR UPDATE`) before reading it.
    - Allows only DRAFT and PARTIALLY_SETTLED invoices: SETTLED gets "already paid", CANCELLED gets "cancelled". PARTIALLY_SETTLED stays allowed because credit sales are paid later from the Sales page; the plan said DRAFT only, which would have broken that.
    - Adds up **all** WALLET lines. The wallet total can't be more than the amount due.
    - Debits the wallet with a conditional `updateMany` (`balance >= total`), so concurrent sales can't spend the same balance. There's one DEBIT_SALE row for the total.
    - Rejects amounts ≤ 0 or not finite, as well as the contract.
  - Overpayment, a deliberate choice: walk-ins are still rejected. A registered customer can still overpay with cash or card, and the extra is credited to their wallet as before. The POS allows this on purpose for registered customers (store credit or advance). Wallet money can no longer be "overpaid" back into the wallet. Change for cash isn't modelled; the POS makes walk-in payments match the total exactly.
  - Tested with the app running (11 checks):
    - Rejected, wallet unchanged: two wallet lines over the amount due, two wallet lines over the balance, re-paying a SETTLED invoice, a wallet overpayment, a walk-in overpayment.
    - Accepted: an exact wallet+cash split (wallet 5 → 0); partial cash 50 (PARTIALLY_SETTLED) then wallet 150 (SETTLED); a card overpay of 250 on 200 (₹50 credited).
    - 5 concurrent settles of one invoice: one 200 and four 400, paid 200, one payment row.
    - Two sales racing for the same ₹200 wallet: one succeeds, balance 200 → 0.
    - The earlier suites and both UI checkouts still pass.
  - Left for later: the receipt amount includes any overpayment credited to the wallet, and payments aren't linked to a register (#12).
- **2026-10-02 (session 2):** Finished #8. `createReturn` now:
  - Locks the invoice row, so concurrent returns can't both pass the quantity check.
  - Accepts only SETTLED invoices. DRAFT and PARTIALLY_SETTLED get "isn't fully paid yet. Collect the payment before returning items."; CANCELLED gets "is cancelled". This is the plan's rule. Returns on unpaid credit sales would need a way to reduce what the customer owes, which the data model doesn't have; that's a follow-up if wanted.
  - Groups request lines by `saleLineId` before checking. The contract already rejects duplicates; this is defence in depth.
  - Caps the total refunded across all returns at what was paid (`min(paidTotal, grandTotal)`).
  - Refund maths, shared as `returnLineRefund` in `packages/contracts/src/pricing.ts` and used by the API and the Returns page: prorated from the line total, and the last units refund exactly what's left. Before, it was `round2(net / sold) × qty`, so a ₹200 line of 3 returned one at a time refunded 3 × 66.67 = ₹200.01. Now it's 66.67 + 66.67 + 66.66 = ₹200.00.
  - The Returns page shows the API's validation messages (`apiErrorMessage`).
  - Tested with the app running (11 checks):
    - Rejected, stock unchanged: DRAFT, PARTIALLY_SETTLED, CANCELLED, a 4th unit of a 3-unit line, duplicate lines.
    - Three 1-unit returns add up to exactly the line total.
    - 5 concurrent 1-unit returns on a 2-unit line: 2 accepted, stock +2.
    - A wallet refund credits the right amount.
    - In the browser, the Returns page showed the same amount the API refunded (₹66.67 after a 2-unit return worth ₹133.33), and showed the "not fully paid" message for an unpaid invoice.
    - The validation, settle and pricing suites still pass.
  - I didn't reproduce the concurrent-return race on the old code; the test only shows the new lock holds.
- **2026-10-02 (session 2):** Finished #9. Reproduced first:
  - 5 registers sold the same last unit (on hand -4).
  - Two lines of one item, or 1 box + 1 piece, oversold.
  - 5 concurrent adjustment-OUTs reached -2.
  - 5 registers opened for one branch.
  - The fix:
    - **Per-item locks:** `lockItemStock` takes a Postgres transaction-scoped advisory lock per (branch, item) (`pg_advisory_xact_lock(hashtextextended('stock:<branch>:<item>', 0))`), in sorted order to avoid deadlocks. Every path that takes stock out takes it before checking and writing: `createSale`, `createStockAdjustment` (now in a transaction), `updateStockOpening`, and `createStockOpening` (now in a transaction, since there's no unique constraint on opening rows).
    - **Register opening:** `openRegister` does its check and insert in a transaction under a per-branch lock (`lockBranchRegister`).
    - **Why not a table row or an index:** this needs no schema change. The plan's partial unique index can't be declared in the Prisma schema, so a later `migrate dev` would detect it and try to drop it. #18's `ItemStock` table can still replace the stock lock later.
    - **`createSale`:** adds up base-unit quantities per item across all lines (a box and loose pieces share stock) and checks once per item, after locking. The message now names the item: "Insufficient stock for X: N on hand, M needed".
  - Tested with the app running:
    - 5 concurrent sales of the last unit: 1 accepted, on hand 0.
    - Two lines of one item, and box + piece over stock: rejected, stock unchanged. A box alone still sells.
    - 5 concurrent adjustment-OUTs on stock 3: 3 accepted, 0 left.
    - Sales + adjustment + opening edit racing: on hand never below 0.
    - 5 concurrent register opens: 1 accepted, 1 open in the database.
    - 30 concurrent sales on stock 10: exactly 10 accepted in 251 ms, no transaction timeouts.
    - The return, settle, pricing, validation and branch suites and the UI checkout still pass.
  - Note: stock that's already negative (including the test items from the reproduction in this local database) isn't repaired; it needs a stock adjustment IN. Lock waits count toward Prisma's default 5 s interactive-transaction timeout; that's fine at shop scale, but raise it if many registers sell the same item at once.
- **2026-10-02 (session 2):** Finished #10.
  - New `POST /sales/checkout` (`checkoutSale`) creates and pays the sale in **one transaction**. The `createSale` and `settleSale` bodies moved into `createSaleInTx` and `settleSaleInTx`, shared by the old endpoints and checkout. If payment fails (wallet, cashier limit, anything), nothing is saved.
    - With no payments it's a credit sale, for registered customers only. Walk-ins must pay in full; the POS already required it, now the server does too.
  - Idempotency: the body carries `idempotencyKey` (a UUID), stored in the new unique column `SaleInvoice.idempotencyKey`.
    - A key that already made an invoice returns that invoice and its latest receipt instead of creating another. Concurrent requests with one key are resolved by the unique index (P2002 → replay).
    - A key made by another user or branch gets 400.
  - POS (`PosPage.tsx`): checkout makes one call. The key is kept together with a fingerprint of the request: an identical retry reuses it, any change to the cart or payments makes a new one, and it's cleared on success.
    - `lib/id.ts` falls back to `crypto.getRandomValues` because `crypto.randomUUID` is missing on plain-http LAN addresses.
    - A network failure now says it's safe to press Validate again.
  - Leftover drafts: instead of a job, there's an **admin action**, `POST /sales/:id/cancel` (`cancelSale`). It works only on DRAFT invoices with nothing paid: it marks them CANCELLED and puts the stock back as a new `StockTxnType.SALE_CANCEL`.
    - Why not a job: unpaid credit sales are DRAFT too, so cancelling every DRAFT would destroy real credit sales.
    - Why a new type: reports count ADJUSTMENT_PLUS as an expense, and they already skip CANCELLED invoices.
    - The Sales page shows "Cancel Invoice" to admins on unpaid drafts, with a confirmation. "Settle" is disabled on cancelled invoices, and settle errors now show the API message.
  - Migration `20261002120000_sale_checkout_idempotency` (made with `migrate diff`, because `migrate dev` needs an interactive terminal for the unique-index warning).
  - Tested with the app running (16 API checks):
    - Exact walk-in checkout settles.
    - An empty-wallet checkout gets 400 and saves no invoice and no stock change. For comparison, the old two-step flow left a DRAFT holding 2 units.
    - Same key twice: same invoice and receipt. 5 concurrent requests with one key: one invoice, stock -1.
    - A credit sale makes a DRAFT with no receipt. A walk-in with no payment or a part-payment gets 400 and nothing saved.
    - Admin cancel: CANCELLED, stock +2, a `SALE_CANCEL` ledger row, today's sales report drops by 200. Cancelling again, settling a cancelled invoice, cancelling a settled one, a cashier cancelling, a cashier reusing the admin's key, and a cashier over the discount limit are all rejected with nothing saved.
    - Browser:
      - With the first checkout response dropped after the server committed, the cashier saw the retry message, pressing Validate again returned the same invoice (1 invoice in total), and the receipt showed.
      - The Sales page cancelled a leftover draft (stock +1), hid the button afterwards, and doesn't show it for settled invoices.
      - The UI checkout, rounding (₹100.00) and cashier-limit flows all pass through `/sales/checkout`.
    - All API suites still pass.
  - `POST /sales` and `POST /sales/:id/settle` still exist: the Sales page uses settle for credit sales.
  - Seen while testing: a barcode scanned before the POS item list has loaded isn't found. That isn't a regression; one of my test scripts tripped over it.
- **2026-10-02 (session 2):** Finished #11.
  - Each sale line now stores `unitCost`: the item's `costPrice` per base unit at the time of sale. Migration `20261002130000_sale_line_unit_cost` adds it and **backfills older lines from each item's current cost**, so history before this change is approximate.
  - `computeReportRange` runs four SQL aggregates per range (`$queryRaw`, because Prisma can't sum `qty × cost`). New fields replace `salesTotal`/`returnsTotal`/`expensesTotal`/`profit`:
    - `invoiceCount`, `grossSales`, `taxCollected`: **SETTLED invoices only**.
    - `returnsGross` / `returnsNet`: the pre-tax part uses each sale line's taxable/net ratio.
    - `netSales` = grossSales − tax − returnsNet.
    - `costOfGoodsSold` = sold qty × unitCost − returned qty × unitCost.
    - `grossProfit` = netSales − COGS.
    - `unpaidSales`: still owed on DRAFT/PARTIALLY_SETTLED invoices, shown separately and not counted.
    - Opening stock and stock-ins are no longer an expense.
  - The Reports page shows the new figures (profit turns red if negative, unpaid credit is shown only when there is some), and the "All branches" total adds every field up.
  - Tested on a fresh branch with a hand-worked scenario: ₹65,000 of opening stock; 2×A (₹100 + 18%, cost 60) and 1×B (₹118 incl. 18%, cost 50) paid; one credit sale; one cancelled draft; one A returned.
    - Report: 2 paid, sales 354, tax 54, returns 118/100, net 200, COGS 110, **gross profit 90**, unpaid 118. All 9 figures matched.
    - The old report would have shown roughly −₹64,646.
    - Changing A's cost afterwards doesn't change past COGS; a new sale uses the new cost.
    - The Reports page shows the same figures, and "All branches" adds up.
    - All API suites and the UI checkout still pass. `checkout-test` now checks `unpaidSales` for the cancelled draft.
  - Not done: average or FIFO costing (it uses the item's cost price when sold); payments aren't linked to registers (#12); report dates use the server's time zone (#15).
- **2026-10-02 (session 2):** Finished #12.
  - Migration `20261002140000_register_cash_balance`:
    - `Payment.registerSessionId` and `ReturnInvoice.registerSessionId` (nullable foreign keys with indexes; older rows stay null).
    - `RegisterSession.expectedCash` and `cashDifference`.
  - Payments (settle and checkout) and refunds are stamped with the session's register. Before writing, they share-lock the register row and check it's still open (`assertRegisterOpen`). Close takes the row exclusively, so nothing can land on a register after it closes.
  - Expected cash = opening + CASH payments on the register − CASH refunds from it (`registerCash`). Card and wallet are excluded. A registered customer's cash overpayment counts in full, because it's in the drawer.
  - `GET /registers/current` returns `cashSales`, `cashRefunds` and `expectedCash`. `POST /registers/close` works out the expected cash under the lock and saves the counted amount, the expected amount and the difference (counted − expected; negative = short).
  - Web:
    - The `window.prompt` close is replaced by `CloseRegisterDialog`: opening, cash taken, cash refunded and expected; a live "Short by / Over by / Balanced" as the cashier types the count; then the saved result before going to the open-register page.
    - The open-register page shows the last close's expected cash and difference.
  - Tested with the app running (7 API checks), on a fresh branch with ₹500 opening:
    - Sales: cash 236, card 118, a registered customer's cash 300 on a 236 bill, wallet 118. Refunds: cash 118, wallet 1.
    - Current register: cash 536, refunded 118, expected 918. All 4 payments linked to the register.
    - Close with 900 counted: expected 918, difference −18, saved on the row and shown in the summary. The old token gets 401 afterwards.
    - 12 checkouts racing a close: 4 landed before it, 8 refused, 0 payments after the close, and expected equalled opening + the cash on the register.
    - Browser: the dialog showed 100 + 236 = 336, "Short by ₹6.00" at 330, "Balanced" at 336, then the result and the open-register line "Expected: ₹336.00 · Balanced".
    - All earlier suites and the UI checkout still pass.
  - Not counted: admin wallet top-ups have no payment mode, so cash taken for a top-up isn't in expected cash. Payments and refunds made before this change aren't linked to any register.
- **2026-10-02 (session 2):** Finished #13. The user's decision: customers are **shared across branches by default** (so loyalty and wallet balance follow the customer between stores of the same brand), and admins can configure it.
  - Migration `20261002150000_customer_scope`: `BusinessSettings.customerScope` (`SHARED` | `BRANCH`, default `SHARED`). It's on the Business Settings page as "Customers: Shared across all branches / Separate for each branch".
  - One rule, `customerUsableAt`, applied the same way to listing, sales (`createSaleInTx`), editing (`updateCustomer`) and wallets (`getWallet`/`topupWallet` via `findUsableWallet`):
    - Every branch's walk-in customer belongs to that branch only.
    - Other customers can be used at any branch in SHARED mode, or only at the branch that created them in BRANCH mode.
    - Wallet payments and refunds follow the customer, so in SHARED mode the balance works at every store.
  - Phone numbers (`assertPhoneFree`): creating or editing a customer rejects a phone another customer already has, business-wide in SHARED mode or within the branch in BRANCH mode. Existing duplicates aren't merged.
  - Customer codes still carry the creating branch (`CUST-<branch>-n`); `Customer.branchId` is now the "home" branch.
  - The #2 change to wallet branch scoping now applies in BRANCH mode only. Sales and receipts stay private to their branch in both modes.
  - Tested with the app running (19 checks, two fresh branches):
    - SHARED: Y lists Asha (created at X), sees her ₹300 wallet, sells to her paid from the wallet (X then sees 182), refunds to her wallet (300), edits her, and tops her up. Y can't create a second customer with her phone or sell to X's walk-in customer.
    - BRANCH: Y can't list, edit, sell to, or open or top up the wallet of Asha; X still can. Y can create its own customer with that phone, but only once.
    - An invalid setting value gets 400. The settings field saves and reloads.
    - `branch-test` (from #2) now runs in BRANCH mode, where wallets are branch-private. All other suites and the UI checkout still pass.
  - There is no loyalty-points feature yet. When one is added, it can hang off the shared customer.
- **2026-10-02 (session 2):** Finished #14. Approach agreed with the user first: walk-ins get cash-only refunds, and existing walk-in balances are left frozen with a startup warning.
  - Reproduced on the old build: a walk-in return refunded ₹100 into the walk-in wallet, and **a different walk-in sale then spent it**. An admin ₹500 top-up and a two-step WALLET settle of a walk-in invoice were also accepted.
  - The screens already hid the wallet for walk-ins, so the hole was server-side. One rule, `assertHasWallet`: walk-in customers have no wallet. It's checked on:
    - WALLET payments (`settleSaleInTx`, so both settle and checkout)
    - WALLET refunds (`createReturn`)
    - wallet reads and top-ups (`findUsableWallet`)

    The message is "Walk-in customers don't have a wallet. Use cash, or pick a registered customer." Registered customers are unchanged.
  - Refunds for walk-ins are cash only. Card refunds weren't added (the user agreed); returns can't refund to card for anyone yet.
  - Existing balances are kept as a record but can't be spent. At startup, `warnAboutWalkInWalletBalances` logs each branch whose walk-in wallet isn't 0, e.g. "Branch W845921: the walk-in customer's wallet holds 400.00 from before walk-in wallets were turned off. It can't be spent; settle these refunds by hand."
  - POS: the wallet query is skipped when the walk-in customer is picked explicitly, so no error appears.
  - Tested with the app running:
    - On the new build, all 5 walk-in wallet actions get 400 and the walk-in wallet stays 0. A cash refund for the same return works. Registered customers can still top up, pay from and refund to their wallet.
    - The startup warning appeared for the ₹400 left by the old-build reproduction.
    - Browser: the POS offers walk-ins Cash and Card only, makes no wallet requests and shows no errors. The Returns page offers only "Cash Refund" for a walk-in invoice.
    - All 10 earlier suites still pass.
- **2026-10-02 (session 2):** Finished #15. Phase 3 is complete.
  - Migration `20261002160000_business_timezone`: `BusinessSettings.timezone` (IANA, default `Asia/Kolkata`).
    - Business Settings shows it as a picker of every zone the browser knows.
    - The contract checks it with `isValidTimeZone` (Intl), so the browser and the API agree.
    - It's business-wide only. A per-branch override can be added later if a brand spans time zones.
  - `apps/api/src/pos/zoned-dates.ts` (no new dependency):
    - `localDate`, `startOfLocalDay` (local midnight as a UTC instant; handles 23/25-hour days and zones where daylight saving skips midnight) and `reportPeriods` (Today, This Week from Monday, This Month).
    - `getSalesSummary` uses it with the business zone, and the old `startOfDay`/`startOfWeek`/`startOfMonth`/`addDays`/`addMonths` helpers, which used the server's clock, are gone.
    - The response includes `timezone`, and the Reports page formats its date labels in it. The last day of a period is now `end − 1 ms` in that zone, instead of the browser's `setDate(-1)`.
  - Tested:
    - Helper: 15 fixed cases: IST day, week and month boundaries; 01:30 IST belonging to the IST date; month and year rollover; New York's 25-hour and 23-hour days; São Paulo 2018, where midnight doesn't exist (this caught a bug, now fixed); Kathmandu +05:45; UTC.
    - A brute-force check of every day 2018–2027 in 9 zones, including Lord Howe, Chatham and Santiago: 32,868 days, 0 wrong.
    - With the app running, sales at 01:30 IST on 2 Oct (still 1 Oct in UTC) and 00:30 IST on 3 Oct (still 2 Oct in UTC): "Today" counts the first in Asia/Kolkata and the second in UTC. An unknown zone gets 400.
    - In a browser set to Los Angeles, the Reports page still labels Today 2 Oct, the week 28 Sep–4 Oct and the month October, with "Asia/Kolkata time" in the header. The picker loads Asia/Kolkata (419 zones).
    - All 11 API suites and the UI checkout still pass.
- **2026-10-02 (session 2):** Finished Phase 5 (#21–#29), before Phase 4, because these are live cashier bugs and splitting `PosPage.tsx` (#19) is easier once its draft logic is fixed. Since #10 a duplicate draft can't create a second sale by retrying, but a stale draft re-opened later still could.
  - The root cause of #22/#23/#27/#28 was relying on the browser's native "leave page?" prompt: it fired after Logout or Close Register had run, offered only OK/Cancel, and tablets often skip it. It's gone (`enableBeforeUnload: false`).
  - `lib/draftStore.ts` (#25, #26, #29): `readDrafts` / `updateDrafts` (always re-read the latest list before writing) / `upsertDraft` (newest first, replacing the same id, max 20) / `removeDrafts` / `subscribeDrafts` (the `storage` event keeps tabs in sync). A failed write throws, and the caller tells the cashier.
  - Leaving with an unsaved cart (#22, #23):
    - In-app navigation (an async `useBlocker` `shouldBlockFn`) shows a custom dialog: **Save draft and leave / Discard cart and leave / Stay**.
    - `lib/leaveGuard.ts` lets the shell ask the open screen first: Logout and Close Register call `confirmLeave()` *before* clearing the session or opening the close dialog, so Stay keeps everything.
    - Discard resets the cart, so the reload afterwards doesn't auto-save it.
  - Closing, reloading or hiding the page (#27, #28): the cart is saved silently as a draft on `beforeunload`, `pagehide` and `visibilitychange` → hidden, through one set of listeners added once that call the latest save through a ref.
  - Paid carts (#21): the active draft id lives in a ref (`activeDraftIdRef`). Nothing auto-saves and leaving is refused while `checkout.isPending`. On success, checkout removes both the draft the cart had when checkout started (`onMutate` context) and the current one. If that removal fails (#26), the success message tells the cashier to delete the draft by hand.
  - #24: going back to orders with an empty cart deletes the resumed draft.
  - Tested in the browser (20 checks):
    - #21: a resumed draft is gone after paying; `pagehide`/`beforeunload` during a slow checkout saves nothing.
    - #22/#23: Logout → Stay keeps the session and cart; Save draft signs out and the draft is there after signing back in. Close Register → Stay doesn't open the dialog; Discard opens it with no draft, even after the reload. Menu navigation → Stay stays on /pos; Save goes to /sales with the draft saved.
    - #24: an emptied resumed draft is removed.
    - #25: two tabs each save a draft; storage holds both and tab 1 lists both.
    - #26: with `localStorage.setItem` throwing, the sale completes and the message explains what to do.
    - #27: `pagehide` saves; a hidden tab updates the same draft (1 draft, 2 items).
    - #28: one POS `beforeunload` listener after 5 cart changes. The router's history adds its own, which isn't part of this.
    - The earlier browser flows (checkout, dropped-response retry, close register, cashier limit, walk-in) still pass.
- **2026-10-02 (session 2):** Started Phase 4, in the order #17, #16, #20, #18, #19, so the riskier refactors (#18, #19) happen with tests in place.
- **#17 done:** deleted the tracked compiled leftovers `packages/contracts/src/index.{js,d.ts}` and their `.map` files; nothing referenced them. `.gitignore` now ignores `*.js`, `*.js.map`, `*.d.ts` and `*.d.ts.map` under `packages/*/src`, like `apps/web/src`. Contracts build, both type checks and the web production build pass.
- **#16 done:** all sale maths now lives in `packages/contracts/src/pricing.ts`.
  - It already had `exclusiveBase`, `lineTax` and `returnLineRefund` (from #6 and #8). Added: `resolveDiscountAmounts`, `allocateDiscountAcrossBases`, and `computeSaleTotals`, which does the whole sale (lines, order-discount plans, `orderDiscountBase`, totals).
  - The API's `calculateSaleTotals` now wraps `computeSaleTotals`, and its private copies are deleted (−170 lines). Before switching, a differential run of the old private code against the shared code on **20,000 random carts** (mixed tax modes, sale units, stacked item discounts, order discounts over 100%, both tax-calculation modes) found **0 differences**.
  - The POS builds the discounts once (`itemDiscountsFor`, `orderDiscounts`), uses them in the checkout request, and runs `computeSaleTotals` on that same input for the screen.
    - This fixes a real mismatch: the POS used to work out a percentage order discount from unrounded item-discount amounts.
    - The "Base eligible / Applied" figures in the order-discount dialog come from the same result.
  - Unit tests: **Vitest** added to `@pos/contracts` (`pnpm --filter @pos/contracts test`, also run by `pnpm test` through turbo). `src/pricing.test.ts` has 14 tests:
    - ₹100 @18% incl. = 84.75 + 15.25; tax-exclusive tax added on top; every price ₹0.01–₹200 at all GST rates stays at its shelf price; BEFORE_DISCOUNT tax.
    - Several discounts on one base, and scaling when they exceed it; allocation in whole paise that adds up and never exceeds a line.
    - A box sale unit; a hand-worked mixed sale (₹297.36); invariants on 3,000 random carts.
    - Return refunds 66.67 + 66.67 + 66.66, and 133.33 + 66.67.
  - Test files are excluded from the package build.
  - Verified: all 12 API suites and the UI flows (rounding, checkout, cashier limit, 20 draft checks) pass on the refactored server. In the browser, a cart with a 7.5% order discount showed tax 80.71 / discount 36.36 / total 529.10, exactly what the server charged.
- **#20 done:** `pnpm test` from the root (turbo builds the shared packages first) runs **88 tests**.
  - `packages/contracts` (Vitest, 25): pricing (#16) and `receiptCss.test.ts` (scoping, and 9 kinds of dangerous CSS dropped and reported).
  - `apps/api` (Vitest + `unplugin-swc` for Nest's decorator metadata, 63): `test/helpers.ts` starts the real `AppModule` on a random port against a separate database `pos_test`. `test/global-setup.ts` runs `prisma migrate reset` on it before every run and refuses any database name without "test".
    - The admin password comes from `SEED_ADMIN_PASSWORD`.
    - Each file creates its own branches and closes leftover open registers.
    - Files run one at a time because some change business-wide settings.
  - API suites, one per fixed area: `auth` (#1, including startup hashing of plain-text passwords), `branch-isolation` (#2), `validation` (#3), `branch-settings` (#4), `pricing` (#5/#6), `settle` (#7), `returns` (#8), `stock` (#9), `checkout` (#10), `reports` (#11/#15), `register` (#12), `customers` (#13/#14), `zoned-dates` (#15 unit).
  - The time-zone test picks its timestamps from the current time, so it passes at any hour. A first version would have failed between 18:30 and 24:00 UTC.
  - Checked that the tests catch regressions by re-breaking four fixes one at a time: no stock lock (2 failures), returns on unpaid invoices (1), the guard ignoring a role change (1), the walk-in wallet check removed (1). The last one passed at first because the empty walk-in wallet refused the payment anyway; the test now gives that wallet a frozen ₹500, and it fails as it should.
  - README: the Quick Start now covers Node 22.12+, `AUTH_SECRET` and building the shared packages. The wrong "Default Seed Users admin/password, cashier/password" section is replaced by how the first admin is created, and a Tests section explains `pnpm test` and the `pos_test` database.
  - The scratch scripts used during sessions 1–2 remain outside the repo; the in-repo suites now cover them.
- **#18 done:** new `ItemStock` table (branch, item, qty; primary key `(branchId, itemId)`).
  - Migration `20261002170000_item_stock` fills it from the ledger: 198 rows in the dev database, summing to the ledger total.
  - Every stock movement goes through one helper, `recordStock`: it takes the item locks, writes the ledger entries and moves the `ItemStock` rows in the same transaction. That covers sales, returns, opening stock (create, and update via `adjustItemStock` with the difference), adjustments and sale cancellations; nothing else writes `stockLedger` now.
  - `getOnHandForItem` / `getOnHand` read one row instead of summing the item's full history.
  - Locking: the per-item advisory lock from #9 is kept rather than switched to row locks on `ItemStock` (it already works, and changing it adds risk for no gain). `recordStock` takes it too, so stock-in paths can't race when a row is first created.
  - Safety net: every API test file now ends with `assertStockMatchesLedger`, which fails if any `ItemStock` row differs from its ledger sum. It immediately caught two test files that wrote ledger rows directly; they now use `addOpeningStock`, which writes both.
  - Verified: 63 API tests pass with the check after every file. On the dev database after the scratch stock, concurrency (30 sales on 10 units → exactly 10), checkout, return and pricing suites and the UI checkout, 0 rows differ.
- **#19 backend done** (the POS screen is next). `pos.service.ts` (2,386 lines) and `pos.controller.ts` (639 lines) are replaced by one folder per area, each with a service and controller:

  | Folder | Contents |
  |---|---|
  | `auth/` | sign-in, startup seeding |
  | `settings/` | business and branch settings, logos |
  | `branches/` | create, list accessible |
  | `users/` | users and branch access |
  | `customers/` | customers, wallets, scope rules, walk-in |
  | `items/` | items |
  | `stock/` | ledger, `recordStock`, locks, on-hand |
  | `registers/` | open, close, cash balance |
  | `sales/` | pricing, create, checkout, settle, cancel, receipts |
  | `returns/` | returns |
  | `reports/` | sales summary, `zoned-dates.ts` |
  | `sequences/` | document numbers |
  | `common/` | plain helpers: `numbers`, `quantities`, `session`, `request-session` (controllers' session checks), `selects`, `types`, `uploads` |

  - Dependencies only point one way. The largest file is now `sales.service.ts` at about 650 lines.
  - The move was scripted: members cut out by name, `this.x` calls rewritten to the owning service, members used across services made public, imports generated. Then the result was read through and tidied.
  - The no-op `withCreatedByName(s)` wrappers and a one-line `exclusiveBase` wrapper were dropped. `AppModule` registers 11 controllers and 13 services.
  - `apps/api` `build` now clears `dist/` first, so deleted files (like the old `dist/pos/pos.service.js`) don't linger in a deploy.
  - Verified:
    - All 63 API tests pass unchanged; the only test edits were two import paths.
    - A route-by-route comparison of the old and new controllers (method, path and every decorator: `@Public`, `@HttpCode`, validation pipes) is identical for all 44 single-line routes, and the 3 upload routes are present with their interceptors.
    - All 12 scratch API suites and the browser flows (checkout, rounding, cashier limit, close register, discount match, 20 draft checks) pass against the dev server running the split backend.
    - The cashier-limit browser script was flaky because it scanned before the POS item list had loaded (the known scan-too-early issue); it now waits and passed 5/5.
- **#19 POS screen done, so #19 is complete.** `PosPage.tsx` goes from 2,221 lines to 795. It still holds the cart, checkout, drafts and the queries; everything else lives in `apps/web/src/screens/pos/`:

  | Kind | Files |
  |---|---|
  | Plain helpers | `cartMath.ts` (rounding, quantities, line amounts, `stepLineQty`), `keyboard.ts`, `receipt.ts` (receipt lines, printable and downloadable HTML), `types.ts` |
  | Hooks | `useStoreSettings`, `useLocalDrafts`, `useLeaveGuard` (blocker, unload listeners), `useOrderDiscount`, `useLineEditor`, `usePayment` |
  | Dialogs | `OrderDiscountModal`, `LineEditorModal`, `PaymentModal`, `CustomerPickerModal`, `LeaveDialog` |
  | Layout | `PostPaymentPanel`, `DraftList`, `CartLines`, `CartTotals`, `CustomerSection`, `ProductGrid`, `PrintableInvoice`, `ReceiptPrintStyles` |

  - Each dialog registers its own keyboard shortcuts while it is mounted and reads the latest handlers through a ref. The old effects were re-attached on every render.
  - The customer picker keeps its own search and create form. They reset because it unmounts on close, which replaces five manual resets.
  - One bug fixed on the way: Apply in the line editor matched cart lines by item id, so with the same item in two units (e.g. PCS and BOX), editing one replaced the other with a copy of the edited line. It now matches by cart key. A browser test failed on the old code and passes on the new.
  - Verified:
    - A browser snapshot of the POS (21 sections: search tiles, categories, the line editor by keypad and keyboard, order discount, customer create and select, payment, receipt text, downloaded invoice, page errors) is identical before and after each step.
    - The draft checks (20), checkout, rounding, cashier limit, close register, discount match, idempotent retry and walk-in browser flows pass.
    - The new unit test covers the two-unit edit and the cart's `-`/`+` buttons. Type check, web build and all 88 tests pass.
- **2026-10-02 (session 3): Phase 6 started on branch `feat/gst-compliance`** (based on `fix/auth-hardening`, whose PR is nathgoutam93/pointofsale#1). The user confirmed: the taxpayer type can be changed later, regular taxpayers can sell inter-state, and B2B is out of scope for now.
- **#30 done.** The taxpayer type is a setting that changes over time, and each sale records the type it was made under.
  - Schema:
    - New `TaxpayerTypeChange` table: type, composition category, `effectiveDate` (YYYY-MM-DD) and `effectiveFrom` (the instant it takes effect), plus who made the change.
    - The type in force at any moment is the latest change at or before it. With no changes, the business is REGULAR.
    - `SaleInvoice` gets `taxpayerType`, `documentType` (TAX_INVOICE / BILL_OF_SUPPLY) and `compositionCategory`. Existing invoices default to REGULAR / TAX_INVOICE.
    - Database checks make sure a composition row always has a category and a regular row never does.
    - Migration: `20261003090000_taxpayer_type`. Prisma named it after the real clock time, which would have sorted before `item_stock`, so it was renamed to sort last.
  - API:
    - `GET /business/taxpayer-type` returns the type in force, any scheduled change, and the history.
    - `POST` (admin) records a change from today or a later date, never backdated. A change for today starts the moment it is saved. Only one change can be scheduled at a time, and changing to the type already in force is rejected.
    - `DELETE /business/taxpayer-type/:id` cancels a scheduled change; a change already in force can't be cancelled.
    - `GET /business/settings` also returns `taxpayerType` and `compositionCategory`.
    - Changing the business time zone moves scheduled changes, so each still starts at midnight on its date.
  - Pricing:
    - `computeSaleTotals` takes `{ chargeTax }`. With `false` (composition), every line is priced untaxed: the customer pays the shelf price less discounts, tax is 0, and lines are saved with rate 0.
    - Checkout looks up the type in force, prices with it and records it on the invoice.
    - The POS uses the same flag in its totals, the line total, and the line editor's percent discount and cap. Cart lines still carry each item's real rate, which the server checks.
    - New file `packages/contracts/src/gst.ts`: types, composition rates (manufacturer and trader 1%, restaurant 5%, services 6%), `documentTypeFor`, `chargesGst`.
  - Bug fixed: under composition, the cashier discount limit compared the list price with tax taken out against a price with tax still in. A cashier could take about 15% off a tax-inclusive item while the limit was 10%. Both sides now use the same tax treatment, and a test covers it.
  - Admin screen: a "GST Registration Type" card on the Business Settings tab. It shows the type in force, any scheduled change (with Cancel), a form to change it (type, category with rate, effective date) and the history. A change for today asks for confirmation first.
  - Verified:
    - 9 new tests: 2 for pricing, 7 for the API. All 97 tests pass.
    - Browser test: regular sale (tax 51.25, total 336, Tax Invoice); switch to composition in settings; the same cart shows tax 0 and total 300 in the cart and line editor; the server charges 300 on a Bill of Supply. Scheduling and cancelling a change also work.
    - The POS snapshot is identical, and the earlier browser flows pass.
  - Not yet: the receipt still prints the same layout for both types (#35), and inter-state blocking needs branch states (#31).
- **#31 done.** Each branch has a GSTIN and a state, and each sale records the seller and where the goods went.
  - Contracts (`gst.ts`):
    - `GST_STATES`: codes 01–38 and 97. The retired 25 (merged into 26) and 28 (undivided Andhra Pradesh) are left out.
    - `gstinProblem`: checks the format, state code and check character. The checksum was confirmed against three published GSTINs.
    - Request schemas upper-case and validate every GSTIN, including the business `gstNumber`. A business with a mistyped GSTIN now has to fix it before saving other business settings.
  - Branch:
    - New fields `gstin` and `stateCode`. Setting a GSTIN sets the state from it.
    - Moving a branch with a GSTIN to another state is rejected unless the GSTIN changes too. A database check backs this up.
    - The GSTIN a branch sells under is its own GSTIN; otherwise the business GSTIN, when that is for the branch's state (or the branch's state isn't set).
  - Sale:
    - New fields: `sellerGstin`, `sellerStateCode` and `placeOfSupplyStateCode`.
    - Checkout takes an optional `placeOfSupplyStateCode` and otherwise uses the branch's state.
    - Rejected: naming a place of supply when the branch has no state, and a composition taxpayer selling to another state.
    - Tax amounts don't change yet; the CGST/SGST vs IGST split comes in #33.
  - Migration `20261003100000_branch_gst_state`: each branch gets the state from the business GSTIN when the business has one, and old sales are treated as counter sales under it. Checked with a dry run in a rolled-back transaction: all 33 dev branches and 664 sales filled in.
  - Admin: GSTIN and State fields in Branch Settings. Typing a GSTIN fills in the state, and invalid GSTINs (branch and business) show the reason as you type.
  - POS: a "Place of supply" choice in the customer section, defaulting to "Over the counter (29 - Karnataka)", with "Shipped to <state>" options and an "IGST applies" note. It is hidden for composition taxpayers and for branches with no state. It is saved with drafts and cleared on a new order.
  - Verified:
    - 13 new tests: 4 for GSTINs and states, 9 for the API. All 110 tests pass.
    - Browser test: a typo is flagged; saving a GSTIN fills in the state; shipping to Maharashtra survives saving and resuming a draft; the server records seller 29 and place of supply 27; the next order is a counter sale (29); under composition the choice is hidden.
    - The POS snapshot is identical, and the earlier browser flows pass.
  - Not yet: receipts still print the business GSTIN. Printing the invoice's own GSTIN and place of supply comes in #35.
- **#32 done.** Items have an HSN/SAC code, a GST unit (UQC) and a supply type, and each sale line keeps the values the item had when sold.
  - Contracts (`gst.ts`):
    - The 45 GST unit codes plus `NA` for services.
    - `suggestUqc`: maps common unit names to a code (PCS, Pc, piece → PCS; Kg → KGS; Litre → LTR; Pkt → PAC...).
    - Supply types: TAXABLE, NIL_RATED, EXEMPT, NON_GST. `defaultSupplyType` picks one from the rate; `supplyTypeProblem` rejects a mismatch.
    - `hsnProblem`: 4, 6 or 8 digits, and at least the business minimum.
  - Change from the plan: only the item's base unit gets a GST unit, not its extra selling units (like BOX). Sale lines store quantities in base units, and the HSN summary reports quantity in one unit per item.
  - Business setting `hsnMinDigits`: 4 (turnover up to ₹5 crore) or 6.
  - Item API:
    - The supply type defaults from the tax rate (above 0 → taxable, 0 → nil rated). A mismatch such as exempt at 18% is rejected, with a database check as backup.
    - When the rate changes and no supply type is given, the current one is kept while it still fits the rate; otherwise it switches to the rate's default.
    - The GST unit defaults to the one suggested by the unit name.
  - Sale lines: `hsnCode`, `uqc` and `supplyType` are copied from the item at checkout. A test confirms they don't change when the item is edited later.
  - Migration `20261003110000_item_gst_details`:
    - 0% items become nil rated.
    - GST units are filled in from unit names, using SQL generated from `UOM_TO_UQC` so the two match.
    - Sale lines take their item's values. HSN codes start empty.
    - Dev data: 230 items (89 taxable, 141 nil rated, all PCS) and 703 sale lines filled in.
  - Admin:
    - Business Settings has an "HSN code length" choice.
    - Both item forms have HSN/SAC code (with instant checks), GST unit (showing the suggestion from the unit name) and supply type (only the options that fit the rate).
    - The item detail view shows these values, and the item list marks items missing an HSN code or GST unit.
  - Existing bug fixed on the Items page: after Create Item, the page selected the new item before the list had refreshed. The selection then fell back to another item, so the detail panel and the Edit button were for the wrong item. The new item is now added to the list first.
  - Verified:
    - 10 new tests: 4 in contracts, 6 for the API. All 120 tests pass.
    - Browser test: HSN length 6 saved; the list flags items without HSN; "Kg" suggests KGS; a 0% item offers nil rated, exempt and non-GST; 5- and 4-digit HSN codes are flagged; saved 100630 / KGS / EXEMPT; the detail view shows them; changing the rate to 5% makes it taxable. The run before the selection fix edited the wrong item.
    - The POS snapshot is identical, and the earlier browser flows pass.
- **#33 done.** Every sale line and invoice stores its tax as CGST + SGST or IGST.
  - `splitGst(tax, interState)` in `@pos/contracts` pricing:
    - Inter-state: all IGST.
    - Within a state: CGST is the half rounded down to the paisa, SGST the rest (15.25 → 7.62 + 7.63).
    - `computeSaleTotals` takes `{ interState }`, gives each line `cgst`, `sgst` and `igst`, and returns `cgstTotal`, `sgstTotal` and `igstTotal`.
  - Inter-state means the place of supply differs from the branch's state. A branch with no state is treated as selling within its state. Composition sales have no tax, so every split is 0.
  - Schema:
    - `SaleInvoiceLine` gets `cgstAmount`, `sgstAmount` and `igstAmount`; `SaleInvoice` gets `cgstTotal`, `sgstTotal` and `igstTotal`.
    - A database check makes each line's split add up to its tax, and stops a line having both IGST and CGST/SGST.
  - Migration `20261003120000_sale_tax_split`:
    - Old lines become IGST when their sale went to another state, otherwise CGST + SGST (using the same rounding as `splitGst`). Invoice totals are summed from their lines.
    - Dev data: 2 IGST lines, 343 CGST/SGST lines, and every invoice's split equals its tax.
  - The POS needs no change: it shows only the total tax, which doesn't depend on the split. Receipts print the split in #35.
  - Verified:
    - 10 new tests: 5 in contracts (including every paisa value up to ₹1,000 and the random-cart invariants), 5 for the API (counter, shipped, no branch state, composition, database check). All 130 tests pass.
    - The place-of-supply browser test now also checks the server charges a shipped sale as IGST 36.00, and a counter sale as CGST 18 + SGST 18.
    - The POS snapshot is identical, and the earlier browser flows pass.
- **#34 done.** Each return line stores its refund as taxable value plus CGST/SGST/IGST.
  - `returnLineAmounts` in `@pos/contracts` replaces `returnLineRefund`:
    - Each part (taxable value, CGST, SGST, IGST) is prorated on the units returned so far, minus what earlier returns took. The last units take whatever is left. The refund is the sum of the parts.
    - So no part can go negative or past the sale line's, and returning a line in any number of steps adds back up to it exactly. Prorating each return on its own could overrun: four single-unit returns of a 0.04 tax (0.02 + 0.02) would take 0.03 of SGST.
    - Refunds can differ from before by a paisa. A ₹200 line of 3 now refunds 66.67 + 66.66 + 66.67 (was 66.67 + 66.67 + 66.66), still exactly 200 in total.
    - The API and the Returns page both use it, so the refund shown before returning is the refund given.
  - Schema:
    - `ReturnInvoiceLine` gets `taxableAmount`, `taxAmount`, `cgstAmount`, `sgstAmount` and `igstAmount`; `ReturnInvoice` gets the matching totals.
    - A database check: the parts add up to the refund, none is negative, and a line never has IGST together with CGST/SGST.
  - Migration `20261003130000_return_tax_split`:
    - Old return lines keep the refund they gave. Their tax is the sale line's share (tax ÷ net), split the way the sale line was. Return totals are summed from the lines.
    - Dev data: 128 lines, 44 with tax, and every return's parts add up to its total.
  - Responses: the return detail and the return lines inside a sale's detail include the parts. The Returns page needs those to prorate the next return.
  - Verified:
    - 5 new contracts tests, including 3,000 random partial-return sequences that each add back up exactly, and 3 new API tests (CGST/SGST, IGST, parts shown with the sale). One existing test was updated for the new 66.67 + 66.66 + 66.67 order. All 136 tests pass.
    - Browser test: 3 × ₹100 including 18% returned one unit at a time from the Returns page. Each amount shown matched the refund (100.01, 99.98, 100.01 = 300.00), and the returned parts add up to the sale line (254.24 / 22.88 / 22.88).
    - The POS snapshot is identical, and the walk-in, register-close, draft and place-of-supply flows pass.
- **#35 done.** Receipts print as a Tax Invoice or a Bill of Supply, from what the invoice recorded.
  - New `apps/web/src/lib/gstReceipt.ts`, used by both the POS receipt (`screens/pos/receipt.ts`) and the Sales page reprint:
    - The title: TAX INVOICE or BILL OF SUPPLY, from the invoice's `documentType`.
    - The invoice's own `sellerGstin`. It used to print the current business GSTIN.
    - "Place of Supply: 27 - Maharashtra" when the goods went to another state.
    - An "HSN 8517" row under each item.
    - "incl. CGST / incl. SGST" or "incl. IGST" in the totals, labelled "incl." because the line totals already include tax.
    - On a Bill of Supply: no tax rows, plus the required declaration "Composition taxable person, not eligible to collect tax on supplies".
  - Every value comes from the invoice, never the current settings: a sale reprinted after switching to composition is still a Tax Invoice.
  - Receipt layout (`lib/receiptFormat.ts`):
    - Takes a `title`.
    - Centred lines (store name, header, title, footer) now wrap instead of being cut at the paper's width. The declaration was being cut at "Composition taxable person, not" on 32-character receipts; long store headers and footers were cut the same way.
    - A metadata entry can print as its own line (`fullLine`), so "Place of Supply" isn't shortened to "Place of Sup".
  - Verified:
    - Browser test with the branch GSTIN set and an item HSN of 8517:
      - Counter sale: TAX INVOICE, GSTIN, HSN 8517, incl. CGST 18.00 + incl. SGST 18.00, no place of supply.
      - Shipped to Maharashtra: Place of Supply 27 - Maharashtra, incl. IGST 36.00 only.
      - Composition: BILL OF SUPPLY with no tax rows, the full declaration, total 200.00. The downloaded copy is the bill of supply too.
      - Reprinting the earlier sale from Sales: still a TAX INVOICE with CGST and HSN.
    - The POS snapshot changed only as intended: the TAX INVOICE title, and incl. CGST 53.55 + incl. SGST 53.55 (equal to the line's 107.10 tax). It is the new baseline; the old one is kept as `pos-before-pre-gst35.json`.
    - All 136 tests pass, and the browser flows pass.
  - Not covered: the Returns page receipt doesn't print GST details. Credit notes for returns come with the returns in #37.
- **#36 done.** GST invoices and credit notes are numbered `{series}/{FY}/{number}`, e.g. `MAIN/2627/00001`.
  - Change from the plan: its example `INV-MAIN-2627-0001` is 18 characters, over GST's limit of 16, and longer branch codes (BLR01) made it worse. Instead, each branch has a short series:
    - Up to 5 letters or digits.
    - Unique across branches, because branches sharing a GSTIN must never issue the same number.
    - Separate series for invoices and returns (e.g. MAIN and MAINR).
    - So `{series}/{FY}/{5 digits}` is at most 16 characters up to 99,999 documents a year. Past that, the sale still goes through and a warning is logged.
  - Contracts (`gst.ts`): `financialYearStart` (April to March), `financialYearCode` (2026 → "2627"), `documentNumber`, `documentSeriesProblem`, `documentSeriesCandidates`.
  - Schema:
    - New `DocumentSequence` table, keyed by kind, series and financial year. Numbers are issued with one `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`, so they're atomic.
    - Counted per series, not per branch: a series handed to another branch carries on instead of starting at 1 and colliding.
    - `SaleInvoice` and `ReturnInvoice` record `documentSeries` and `fiscalYear`, for the document summary in #37. Issued and cancelled counts come from them, with no separate counters.
  - The branch's `invoicePrefix` and `returnPrefix` are now these series (letters and digits, at most 5, unique). Receipt numbers (not GST documents) and customer codes are unchanged.
  - Migration `20261003140000_gst_document_numbers`, written by hand because Prisma won't generate unique constraints without a prompt:
    - Each branch gets an invoice series from its code (first 5 letters or digits), or X0001... where codes clash. Every branch had the same "INV" prefix, which couldn't stay.
    - Return series: the first 4 characters plus R, or R0001... where that clashes.
    - Then the unique indexes. Old invoices and returns record their old-style series (e.g. INV-MAIN) and financial year.
    - `prisma migrate diff` reports no difference from the schema. Dev data: 33 branches, 5 needed the X fallback.
  - New branches get the first free series from their code (an advisory lock stops two new branches taking the same one). Taking another branch's series is refused with its name.
  - Invoice numbers now contain "/". `GET /receipts/by-invoice/:invoiceId` still accepts a number, but URL-encoded (`MAIN%2F2627%2F00001`). The web app only passes ids there; invoice-number searches go through query strings, which are encoded.
  - Admin: "Invoice series" and "Return (credit note) series" fields with upper-casing, a 5-character limit, the rules shown as you type, and example numbers for the current financial year.
  - Verified:
    - 4 new contracts tests and 6 new API tests: series from the code; numbering 00001, 00002 within 16 characters; credit notes; uniqueness, length and character rules; a series handed to another branch continuing at 00003; 6 sales at once getting 6 different numbers. Two existing tests updated: the prefix test, and the branch-isolation test now URL-encodes the number. All 147 tests pass.
    - Browser test: example numbers shown; a slash flagged as you type; another branch's series refused; a sale numbered MAIN/2627/00001; the Sales page finds it by number.
    - The POS snapshot is identical (the snapshot script now hides new-style numbers too). The other browser flows pass after updating three scripts for the new format.
- **#37 done.** GSTR-1 for one GSTIN over one month, or a quarter (Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar): a preview, a problem list, and the JSON to upload.
  - `apps/api/src/gst/gstr1.ts`: `buildGstr1` as plain functions over invoice and return records, so it can be tested without a database. Sections:
    - **B2CS:** by intra/inter-state, place of supply and rate, net of returns made in the period.
    - **B2CL:** inter-state invoices above `B2CL_THRESHOLD` (₹1,00,000 since August 2024), items grouped by rate.
    - **CDNUR:** returns of B2CL invoices.
    - **Nil / exempt / non-GST:** within and between states.
    - **HSN summary:** `hsn.hsn_b2c`, quantity in GST units, net of returns.
    - **Document summary:** per series, from/to, total and cancelled, for invoices (doc 1) and credit notes (doc 5).
  - What's included: only invoices recorded as REGULAR and carrying this GSTIN. Cancelled invoices are counted in the document summary only. The period uses the business time zone; `fp` is MMYYYY of the last month.
  - Problems:
    - **Errors** (they block the download): items sold with no HSN code or no GST unit.
    - **Warnings:** composition sales left out; sales with no GSTIN that could be this GSTIN's (same state, or a branch with no state); returns larger than sales in a B2CS row; numbers longer than 16 characters from before GST numbering.
  - API (admins only): `GET /gst/gstins` lists branch GSTINs, the business GSTIN and GSTINs on past sales. `GET /gst/gstr1?gstin&from=YYYY-MM&to=YYYY-MM` returns `{ json, problems, summary }`.
  - Web: a "GST Returns" page (menu, admins only):
    - Choose the GSTIN, and monthly or quarterly filing; it defaults to last month.
    - Errors and warnings are listed, with preview tables for every section.
    - "Download GSTR-1 JSON" is disabled while there are errors.
  - **Check before filing:** the layout follows the GSTR-1 offline tool from memory, and the format changes from time to time (the HSN table split into B2B/B2C recently). `GSTR1_JSON_VERSION` and `B2CL_THRESHOLD` are single constants. Import the file into the current offline tool, adjust anything it rejects, and have a CA review a real month before filing.
  - Verified:
    - 6 builder tests (B2CS, B2CL with the threshold boundary, nil/exempt/non-GST, returns netted vs CDNUR plus HSN net of returns, cancelled invoices, problems) and 4 API tests with real sales (GSTIN list; all sections from counter, shipped, B2CL and exempt sales plus a return; month or quarter only; admins only). All 157 tests pass.
    - Browser test against a production build (the dev server had stopped at its time limit): three sales under a fresh GSTIN. The page shows 3 invoices, intra-state 400.00 with CGST 36 + SGST 36, inter-state 200.00 with IGST 36, HSN 8517 for 3 PCS. The downloaded `GSTR1_<gstin>_<MMYYYY>.json` matches. A sale of an item with no HSN shows an error and disables the download.
    - POS snapshot identical; other browser flows pass. The draft listener-count check reports 0 against a production build, because it finds listeners by source file name and the bundle has none; it passed against the dev server.
- **#38 done.** The sales side of GSTR-3B, from the same figures as GSTR-1 so the two always agree.
  - `apps/api/src/gst/gstr3b.ts`:
    - **3.1(a)** taxable outward supplies (B2CS + B2CL − CDNUR): taxable value, IGST, CGST, SGST.
    - **3.1(c)** nil rated and exempt; **3.1(e)** non-GST.
    - **3.1(b)** zero rated and **(d)** reverse charge are 0: no exports or purchases are recorded.
    - **3.2** inter-state supplies to unregistered persons, by place of supply, net of credit notes.
    - Only GSTR-1's warnings carry over (HSN details don't matter for 3B), plus a standing note that input tax credit (Table 4) isn't included.
  - `GET /gst/gstr3b`, with the same GSTIN and month-or-quarter query as GSTR-1. The service now loads a period once for both returns.
  - Web: the GST Returns page has a "Return" choice (GSTR-1 / GSTR-3B). The views live in `screens/gst/`: `Gstr1View`, `Gstr3bView`, and `shared.tsx` (table, problem list, status).
  - Verified:
    - A builder test (3.1 net of a B2CL credit note, nil and non-GST, 3.2 by state) and an API test against the real sales from the GSTR-1 test (taxable 152,000, IGST 27,180, CGST/SGST 90; exempt 200; Maharashtra 151,000 / IGST 27,180; quarter rule).
    - Browser test extended: GSTR-3B shows 3.1(a) 600.00 with IGST 36, CGST 36, SGST 36, 3.2 Maharashtra 200.00 / 36.00, and the input tax credit note.
    - All 159 tests pass.
- **#39 done, so Phase 6 is complete.** Composition returns.
  - `apps/api/src/gst/composition.ts`: `buildComposition` over the sales made as a composition taxpayer (cancelled ones excluded), net of returns, by category:
    - Turnover (exempt included), taxable turnover, and the base the rate applies to: taxable supplies for traders, all turnover for manufacturers, restaurants and service providers.
    - CGST/SGST at half the rate each (1%, 5%, 6%), split like invoice tax.
    - Warnings: regular-taxpayer sales left out; inward supplies missing (purchases aren't recorded).
    - Turnover limit, on the business's turnover this financial year across all GSTINs: a warning at 80% of the limit and an error past it, telling the admin to move to regular (schedule the change, file CMP-04). Limit: ₹1.5 crore, or ₹50 lakh for services. Special category states have lower limits; this is noted, not built.
  - API (admins only):
    - `GET /gst/cmp08?gstin&from&to`: quarters only.
    - `GET /gst/gstr4?gstin&fy`: April–March, with `byQuarter` (the four CMP-08s).
    - The service now validates the period once (month / quarter / year) and computes year turnover with two aggregate queries.
  - Web: the Return choice adds CMP-08 (quarter picker only) and GSTR-4 (financial year only). The view shows business turnover this year, the problem list, the table by category, and, for GSTR-4, quarter by quarter.
  - Verified:
    - 5 builder tests (trader vs restaurant base, odd-paisa split, returns netted, cancelled and regular sales excluded, the limit at 87% / past it / services / no longer composition, the quarter split).
    - 3 API tests with real sales: a regular sale, then a composition change, phones and exempt rice and a return. CMP-08 shows 2,200 turnover, tax on 2,000 = CGST 10 + SGST 10, with the regular sale left out; GSTR-4 shows it in this quarter; month and year validation.
    - Browser test: two composition sales of the 200 item. CMP-08 shows Trader at 1%, 400.00, CGST 2.00 + SGST 2.00. GSTR-4 shows them in October–December. The period choices change with the return.
    - All 167 tests pass.
  - **Phase 6 recap.** Regular and composition taxpayers are supported end to end:
    - Each sale records its GSTIN, place of supply, HSN/UQC/supply type, CGST/SGST/IGST and a GST number.
    - Returns record their tax parts.
    - Receipts print a Tax Invoice or a Bill of Supply.
    - The GST Returns page gives GSTR-1 (JSON), GSTR-3B, CMP-08 and GSTR-4.
  - **Before relying on it:** import a real month's GSTR-1 JSON into the current GST offline tool (`GSTR1_JSON_VERSION`, `B2CL_THRESHOLD` and the HSN table layout are the likely places to adjust), and have a CA review one month of all four reports.
- **#40 done.** Multiple counters per branch.
  - Migration `20261004100000_branch_counters`: `Counter` table (unique name per branch); one "Counter 1" per existing branch; `RegisterSession.counterId` backfilled, then required.
  - API:
    - `GET /branches/:branchId/counters` (anyone with access to the branch; `?includeInactive=true` for all), `POST /branches/:branchId/counters` and `PATCH /counters/:id` (admins: name, isActive).
    - `POST /registers/open` takes `counterId`. It may be left out only when the branch has a single active counter. The open check runs under the per-branch lock (`lockBranchRegisters`, shared with deactivation), so a counter can't be opened twice or deactivated while it opens.
    - `GET /registers/summary` returns each branch's active counters with their open and last closed register. Register responses carry `counterId`, `counterName` and `openedBy`; login returns the open register's counter.
    - New branches (and the first-run "Main Branch") get "Counter 1".
  - Web: the open-register page picks a branch, then a free counter (who has each one open, or its last close), then the opening cash. Settings → Branches has a Counters card (add, rename, deactivate/activate, who has each open). The header shows the counter ("Counter 2 open") and the close dialog names it.
  - Counter names are unique per branch ignoring case (checked under the branch lock; the database index is exact-case only).
  - Verified: 4 API tests (default counter and admin-only management, case-insensitive names; two cashiers on two counters with separate cash; wrong-branch and inactive counters refused; 5 cashiers racing for one counter, 1 opens). All 125 API tests pass. Dev database migrated: 49 register sessions moved onto their branch's Counter 1. Browser test: added Counter 2 to Bengaluru (a case-only duplicate is refused); the open-register page shows Counter 1 in use by admin and Counter 2 free, and blocks a second counter for the same user; opened Mysuru Counter 1, the header showed "Counter 1 open", closed it balanced, back to the counter list.
  - Not done: assigning cashiers to particular counters, per-counter numbering series, and the counter on printed receipts and in reports.
