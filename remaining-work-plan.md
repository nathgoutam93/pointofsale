# Remaining work

Written 2026-10-03, after the desktop app, online server, password resets, cookie sessions,
email features and the fallback counter (see `desktop-offline-online-plan.md`). The earlier
`fix-plan.md` (security, money, GST; all done) and `b2b-implementation-plan.md` (its useful parts
are items 10 and 11 here) were removed; both are in git history. These are left
for later. Each item says why it matters, what to do and when it's done. Tick items off here
and add a line to the progress log at the end.

How to pick one up:
1. Read the item and the files it names; check them first, as paths may have moved.
2. Work on `fix/auth-hardening` (or the branch it was merged into) and keep the test suites
   green: `pnpm --filter @pos/api test`, `pnpm --filter @pos/contracts test`, `pnpm -r typecheck`.
3. For anything the desktop app does, check it in Electron as earlier work did (see the
   "Verified" notes in `desktop-offline-online-plan.md`).

---

## Decisions needed first

These need an answer from the product owner before the work that depends on them.

- ~~**Hosting:** provider and domain for the online server.~~ Decided: `pos.hackd.in` on Oracle
  Cloud (item 3). The domain may change later; see "Hosting modes".
- **Code signing:** Windows and macOS certificates (needed for item 2).
- ~~**Browser use:** should online businesses also use the web app in a plain browser?~~
  Decided: yes, with sign-up there too. `deploy/nginx-pos-web.conf` serves it and `deploy.sh`
  publishes it (README, "The web app in a browser").
- **After moving online:** how long to keep the computer's read-only copy, and whether to offer
  deleting it.
- **Pricing and limits:** plans for managed hosting: price per month and year, how many branches
  and counters each allows, trial length (needed for item 14).
- **Payment provider:** for managed hosting subscriptions. Razorpay Subscriptions is the likely
  choice (INR, UPI AutoPay, cards) (needed for item 14).
- **Self-hosting price:** free, or a fee (one-time or yearly) with paid support (needed for item
  15, later). Decided: self-hosters get built images only, with a licence key (item 15).
- **Self-hosting licence:** the proprietary licence (EULA) text for the images: no reselling or
  hosting for others, no reverse engineering, no getting around the licence key. Have a lawyer
  check it (needed for item 15).
- **Self-hosting licence expiry:** whether licence keys expire and what happens then (keeps
  working without updates, or refuses new businesses) (needed for item 15).

---

## Hosting modes (decided 2026-10-03)

The product comes in three forms:

1. **Offline:** one branch, one counter, everything on one computer, with local backups the owner
   controls (number of days, a second folder). Built; see the desktop app in README.md.
2. **Managed hosting:** our server, `pos.hackd.in` today (the address may change). Businesses
   sign up, get a trial and pay a subscription. **This comes first** (items 13 and 14).
3. **Self-hosted:** a business runs the online server on its own infrastructure, with more
   setup on their side. **Later**, once managed hosting is taking payments (item 15).
   **Decided 2026-10-03:** the source stays closed. Self-hosters get built images only, under a
   proprietary licence, with a signed licence key that limits how many businesses a server may
   hold, so a self-hosted server can't be resold as hosting (item 15). Closing the source means
   making this repository private and moving the desktop app's update feed first (item 16).

How the app tells managed from self-hosted:
- **The server says what it is,** not the hostname. A `POS_HOSTING` setting (`managed` or
  `self`, default `self`) is set to `managed` only on our server, and `GET /meta` returns it. The
  app follows that answer for whatever server it is connected to. Any other server, with any
  hostname, is self-hosted.
- Why not the hostname: the domain may change (installed apps have the old one built in), the
  same server can have other names (a staging server, `www.`, an IP), and billing has to be
  enforced on the server anyway.
- `posServerUrl` in `apps/desktop/package.json` stays as the default address for "Create an
  online business", "Join" and "Move online". It no longer decides anything else.
- When the domain changes: keep the old domain pointing at the server (or redirecting) until
  apps have updated, since installed apps keep the full address in their config
  (`apiBaseUrl`); or have an update rewrite the old address to the new one.

Order of work: fixes to the product come before selling it, starting with everything in
`pre-launch-audit.md` (all of it must be done before launch). Then 13, then 14. Before charging anyone, also finish the rest of item 3 (off-server
backups, a practised restore, uptime monitoring) and item 7 (data export), which paying
customers expect. Item 16 (closing the source) must be done before the first real release. Item 15 comes after
managed hosting is selling.

---

## [x] 1. Crash reporting

- **Why:** a crash on a shop's computer (desktop main process, local API, the page) is invisible
  to us today. The only trace is the log folder on that computer, which "Open logs folder"
  shows.
- **What:**
  - Choose a service (Sentry is the usual choice; it has Electron, Node and browser SDKs) or a
    small endpoint of our own on the online server.
  - Desktop main: `@sentry/electron`, or `process.on('uncaughtException' | 'unhandledRejection')`
    and `app.on('render-process-gone')`.
  - The local API child process: `LocalApi` already logs a stopped API (`apps/desktop/src/api-server.ts`).
  - The page: `window.onerror` and React error boundaries.
  - The online API: Nest's exception filter for 5xx.
  - **Privacy:** reports must not carry customer data, receipt contents, tokens or cookies.
    Scrub request bodies and headers, send only stack, app version, OS and mode. Ask on first
    launch (or in Settings) whether to send reports, and keep a switch to turn them off.
  - **Offline computers:** queue reports in `userData` and send them when the computer is
    online, or never for an offline-only business that turned reports off.
  - Report the app version (`APP_VERSION`), mode (offline/online/fallback) and business id
    (never names) so reports can be grouped.
- **Done when:** a crash in each of main, local API, page and online API reaches the chosen
  service with version and mode, nothing personal, and the switch works.
- **Status (2026-10-04):** built, with our own endpoint (no third party).
  - **Where reports go:** the `CrashReport` table in the control schema (migration
    `20261016120000_crash_reports`), kept 90 days.
    - `POST /crash-reports`: online, needs no sign-in, 60 deliveries an hour per address.
    - A signed-in page's report gets the business id from its token. A desktop report carries
      only the install's random device id.
    - `node dist/tenancy/cli.js crashes [--days 7]` lists reports grouped by crash: count,
      versions, modes, computers, businesses and the top frames.
  - **What is sent:** the error's first line and its stack frames only, never request bodies.
    The text is scrubbed of emails, tokens, GSTINs, numbers, URL queries and user folders
    (`crashDetails` and `scrubCrashText` in contracts; the desktop app has a copy). The server
    scrubs again.
  - **Online API:** `ServerErrorFilter` answers as before and records every unexpected 500. A
    deliberate 503 is not recorded.
  - **Desktop app:**
    - Captures uncaught errors and rejections, a renderer or child process that stops, the local
      API stopping (exit code and frames only), and the page's errors.
    - Reports wait in `crash-reports.json` in the app's folder (at most 50) and are sent every
      10 minutes and after each new one. That is the app's server online, or the hosted server
      (`posServerUrl`) for an offline install.
    - Nothing is sent until an admin says yes: a one-time prompt, plus a switch in
      Settings → Business. No drops what is waiting.
  - **Browser:** the page sends its errors to the server it already works with. A crashed screen
    shows "Something went wrong" with Reload (`CrashBoundary`).
  - **Tests:**
    - `crash-reports.test.ts`: scrubbing, the business from the token, grouping, and a real 500
      recorded without the request's data.
    - Contracts `crash.test.ts`.
    - In the desktop app (offline install, xvfb): a page crash was kept before anyone answered,
      then sent after "Send reports", and listed by the CLI.

## [ ] 2. Windows and macOS builds, signing, icons, first real release (plan 3.7)

- **Why:** only Linux (AppImage) has been run for real.
- **What:**
  - App icons (`apps/desktop/build/`).
  - Windows code signing (NSIS) and macOS signing plus notarization in
    `.github/workflows/desktop-release.yml`.
  - Run the installed app on each OS: offline first launch, backups, printing, updates.
  - Tag a first release and check auto-update from GitHub Releases, which so far was tested
    only with a local update server.
- **Done when:** signed installers for all three OSes install, run and update from a real release.
- **Status (2026-10-03):** v0.1.0 and v0.1.1 are published on GitHub Releases, built unsigned
  by the release workflow (v0.1.1 for Linux, Windows and macOS). A forced update was tested: with
  `MIN_CLIENT_VERSION=0.1.1` on the server, an installed 0.1.0 app was turned away, downloaded
  0.1.1 from the release and restarted into it. Left for this item: icons, Windows and macOS
  signing, and a full run of the installed app on Windows and macOS (backups, printing).

## [ ] 3. Hosting infrastructure (plan 4.8)

- **What:**
  - The online API behind TLS, with a reverse proxy that sends `X-Forwarded-Proto` (the session
    cookie's `Secure` depends on it, or set `SESSION_COOKIE_SECURE=true`).
  - PostgreSQL with automated backups and point-in-time recovery.
  - `node dist/tenancy/cli.js migrate` on every deploy, before the new API starts.
  - A real SMTP account (`SMTP_URL`, `MAIL_FROM`): owner verification is required by default.
  - `MIN_CLIENT_VERSION` raised when a release needs it.
  - Health checks and monitoring.
- **Done when:** a deploy runs migrations then the API, owner sign-up works with real email,
  and a restore of the database has been practised.
- **Status (2026-10-03):** the server runs at `pos.hackd.in` (Oracle Cloud, Ubuntu 24.04):
  PostgreSQL, the API as a systemd service, nginx with a Let's Encrypt certificate. The setup is
  in README.md ("Hosting the online server"); `deploy/deploy.sh` pulls, builds, migrates and
  restarts; `deploy/backup.sh` makes the nightly database and uploads backups (cron at 21:30
  UTC). Email works through Brevo SMTP, and owner verification is on. Still to do:
  - [ ] An off-server copy of the backups: Oracle Object Storage (free tier) with rclone, then
        `POS_BACKUP_RCLONE_REMOTE` in the API's `.env` (see `deploy/backup.sh`).
  - [ ] A restore practised on the server (README, "Backups"), into `pos_restore_test`.
  - [ ] Uptime monitoring on `https://pos.hackd.in/meta` (UptimeRobot or similar).

## [ ] 4. Uploaded files in object storage (plan 4.6)

- **Why:** online logos and item images are on the API server's disk (`UPLOADS_DIR`). That
  breaks with more than one API server, or a redeploy without a shared volume.
- **What:** an S3-compatible store behind the `/uploads/…` paths the app already saves (item
  images are relative paths since the session-hardening change). Moving a business online
  copies its uploads there.
- **Done when:** two API instances serve the same images, and a redeploy keeps them.

## [ ] 5. Rate limits shared between API processes

- **Why:** `FailureLimiter` (`apps/api/src/common/rate-limit.ts`) counts in memory, per process:
  wrong passwords, code emails, business creation, receipt emails. With several processes the
  limits multiply.
- **What:** a shared store (Redis, or a PostgreSQL table with expiry) behind the same interface,
  or limits at the load balancer.
- **Done when:** the limits hold across two API processes.

## [x] 6. CI and merging the branch

- **Why:** `fix/auth-hardening` carries all the desktop, online, security and email work and
  hasn't been merged.
- **What:**
  - A workflow that, on every push and pull request, runs typecheck, the API tests (with a
    PostgreSQL service) and the contracts tests.
  - Open the pull request, review it and merge.
- **Done when:** CI is green on the pull request and it's merged.

## [x] 7. Data export for online businesses

- **Why:** offline businesses have backups; an online owner can't download a copy of their own
  data (and may need one to leave, or for their accountant).
- **What:** an owner-token endpoint that streams the business's tables (the migration bundle
  format, `ExportService`, already does this for offline businesses) plus a readable CSV
  option for sales and GST. A button in Settings for admins, or the owner screens.
- **Done when:** an owner downloads a complete copy and it can be restored into an offline install.
- **Status (2026-10-04):** built. Settings → Your data (admins).
  - **Everything** (`GET /exports/business`, online only):
    - Downloads every table of the business with its logos and item pictures, in the local
      backup format (reason `export`), not the move-online bundle. The desktop app's first-launch
      "Restore from a backup" takes it.
    - Only for an admin of every branch.
    - One export at a time per business, and 6 an hour.
    - Restored into an offline install, a former fallback counter opens on any computer: the
      fallback binding only counts online and on the fallback copy.
  - **Sales register** (`GET /exports/sales.csv?from&to&branchId`, online and offline):
    - One row per invoice and credit note (credit notes negative), with buyer GSTIN, place of
      supply, taxable value, CGST, SGST, IGST, paid, credited, owed, refunded, status and
      payment modes.
    - Dates are in the business's time zone.
    - Every branch the admin manages when no branch is chosen.
    - Text that a spreadsheet would run as a formula is defused.
  - **Tests:** `exports.test.ts` (the export restored into a fresh database, pictures included;
    admin-of-every-branch rule; CSV rows). Both downloads were also checked in a browser.
  - **Not done:** a GSTR-1/3B CSV. The GST Returns screen already downloads the GSTR-1 JSON and
    shows both returns.

## [x] 8. Owner screens

- **What:**
  - A screen for owners (owner sign-in) listing their businesses and each business's staff, to
    reset passwords or deactivate staff there instead of through "Forgot your password?".
  - Invites, if joining by business code turns out not to be enough.
- **Done when:** an owner manages staff of every business from one place.
- **Status (2026-10-04):** built (no invites; joining by business code is enough so far).
  - **Screen:** `/owner`, reached from "Business owner? Manage your staff" on the online sign-in.
    - The owner signs in with the owner account; the owner token stays in the page.
    - It lists the owner's businesses, and for one business its staff: role, home branch, how
      many branches they manage, off, and whether they must choose a new password.
    - Each staff member can be given a new password, or turned off or on.
  - **API (owner token):**
    - `GET /accounts/businesses/:businessId/staff`.
    - `POST /accounts/staff-active`. Turning a user off signs them out everywhere, because each
      request checks `isActive`. The last active admin stays on.
    - Both use the same membership check as `staff-password`.
  - **Tests:** `passwords.test.ts` ("see their staff and turn them off and on"), plus a browser
    run of the screen.

## [ ] 9. Real hardware

- **What:**
  - Receipt printing, the cash drawer kick and the bill-number barcode on real thermal printers
    (Epson, TVS, Xprinter), on Windows and Linux.
  - Scan a printed barcode on the Returns screen.
  - So far only a printer that saves PDFs has been used.
- **Done when:** each works on at least two printer brands.

## [x] 10. B2B GST customers (registered buyers)

- **Why:** a customer has only a name and phone, so every sale is filed as a sale to an
  unregistered buyer (B2C). A shop selling to a registered business can't put the buyer's GSTIN
  on the bill, the buyer can't claim input tax credit, and GSTR-1 is wrong for those sales: it has
  no B2B or B2B credit-note section (`apps/api/src/gst/gstr1.ts`).
- **What:**
  - Customer: GSTIN (validated like the branch's, `gstinProblem` in contracts), state, billing
    address and email. Shown in Customers only when a GSTIN is given; the POS flow stays the same
    for walk-in and retail customers.
  - Sale: record the buyer's GSTIN, legal name and address on the invoice at checkout (as the
    seller's GSTIN is recorded), and take the place of supply from the buyer's state, so a buyer
    in another state is charged IGST. Optional PO / reference number.
  - Receipt and emailed receipt: the buyer's name, GSTIN and address on the tax invoice.
  - GSTR-1: the B2B section (invoices by buyer GSTIN) and CDNR (credit notes for returns on those
    invoices); keep B2CL/B2CS for the rest. GSTR-3B 3.1 already totals by place of supply.
  - The customer email doubles as the address offered by "Email the receipt".
  - Fallback counter: offline sales to registered buyers sync with the buyer details.
- **Done when:** a sale to a customer with a GSTIN prints their details, is listed under B2B in
  GSTR-1 (and its return under CDNR), and imports into the GST offline tool.
- **Status (2026-10-04):** built.
  - **Customer:** `gstin`, `address` and `email` (schema.prisma; migration
    `20261015100000_b2b_customers`). The GSTIN is validated by the contract (`gstinSchema`), and
    the buyer's state is its first two digits, so there's no separate state field.
  - **Sale:** at checkout the invoice records `buyerGstin` and `buyerAddress` from the customer as
    they are then, and an optional `reference` (the buyer's order number).
  - **Place of supply, a correction to the plan above:** it stays the branch's state for a counter
    sale, even when the buyer is in another state. Goods handed over at the counter are supplied
    where they are delivered (IGST Act s.10(1)(d)), so CGST and SGST apply. It is the buyer's state
    only when the goods are shipped there. The POS shows the buyer's state and offers "ship to" it.
  - **Receipt:** printed and emailed tax invoices carry Buyer, Buyer GSTIN, Address and Ref
    (`gstMetadata` in `receiptDocuments.ts`).
  - **GSTR-1 (`gstr1.ts`):**
    - B2B (by `ctin`) and CDNR sections.
    - Nil rows `INTRB2B` and `INTRAB2B`.
    - Separate `hsn_b2b` and `hsn_b2c` tables.
    - B2CS and B2CL now leave registered buyers out.
  - **GSTR-3B:** 3.1 includes B2B, and 3.2 still lists unregistered buyers only.
  - **Screens:**
    - Customers: GSTIN, address and email.
    - POS: a registered-buyer note, a reference field and the "ship to" hint. The customer search
      also matches a GSTIN.
    - Sales: shows the buyer's GSTIN and reference.
    - "Email the receipt": offers the customer's email.
    - GST Returns: B2B and CDNR tables.
  - **Fallback counter:** offline sales carry the same fields.
  - **Tests:**
    - `b2b-customers.test.ts`, the builder tests in `gstr1-builder.test.ts`, and a receipt test in
      contracts.
    - In a browser: a customer created with a GSTIN, then a POS sale shipped to their state; the
      receipt and GSTR-1 checked.
  - **Not checked yet:** importing a file with B2B and CDNR into the current GST offline tool. Do
    it before filing.

## [x] 11. Receivables: credit limits, due dates, statements

- **Why:** credit sales, part payments, the amount due per bill and per customer, and returns
  against the due already work; what's missing is control and follow-up.
- **What:**
  - A credit limit per customer, with a warning, or a block for cashiers, at checkout when a credit
    sale would go over it.
  - Payment terms (days) per customer, giving each credit bill a due date; overdue bills marked on
    Sales and Customers.
  - A customer statement: bills, payments and returns over a period, with the balance; and an
    ageing view of what each customer owes (0–30, 31–60, 61–90, 90+ days). Printable and, online,
    emailed.
  - Not planned: a separate "on account" payment mode (a credit sale already is one), quotations,
    customer price lists.
- **Done when:** a customer over their limit is warned or stopped, overdue bills show, and a
  statement matches the bills and payments.
- **Status (2026-10-04):** built.
  - **Customer:** `creditLimit` (none when empty) and `paymentTermsDays`; only admins set them.
    **Sale:** `dueDate`, the start of the day the terms run out (business time zone), set at
    checkout; none without terms. Migration `20261015110000_receivables`.
  - **What is owed** is grandTotal − paidTotal − creditedTotal on unpaid and part-paid bills, at
    every branch (the customer owes the business). A bill is overdue once its due date is before
    today.
  - **Checkout (`ReceivablesService.assertWithinCreditLimit`):** a credit or part-paid sale that
    takes a customer past their limit is refused for cashiers (400, `CREDIT_LIMIT_EXCEEDED`); admins
    may go past it. The customer's row is locked, so two tills can't both use the last of the room.
    The POS shows "Owes ₹X of ₹Y limit" and the overdue amount, and the payment dialog says how much
    more to take (a cashier can't validate; an admin is warned).
  - **API:** `GET /customers/:id/account`, `GET /customers/:id/statement?from&to`,
    `POST /customers/:id/statement/email` (online, 30 an hour per user) and
    `GET /customers/ageing?branchId`.
  - **Statement:** bills as debits; payments as credits, only what they took off the bill (the
    extra that went into the wallet is noted, not counted); returns as credits of what they took off
    what was owed (refunds aren't on the account). Opening balance, running balance, closing
    balance, and what is owed now by age.
  - **Screens:** Customers: credit fields for admins, credit limit and available room, overdue
    amount, a Statement panel (period, print, email) and an "Owed" (ageing) view; the list marks
    overdue customers. Sales: an Overdue badge and the due date.
  - **Tests:** `receivables.test.ts`; in a browser: limit set, a cashier stopped and then within it
    after a part payment, overdue marks, statement printed and emailed, ageing.

## [x] 12. Smaller follow-ups

- **Receipt builder:** done. The Sales screen builds its receipt lines with `invoiceReceiptItems`,
  as emailed receipts do (checked in the desktop app: the same lines as the emailed receipt).
- **Transfers by cashiers:** done. `GET /stock-transfers/destinations` lists every branch for
  anyone allowed to send; the Transfers screen uses it (test in `transfers.test.ts`; checked in
  the desktop app with a cashier who works at one branch).
- **POS check:** done. "Email the receipt" after a sale on the POS screen sends it (checked in the
  desktop app).
- **Fallback counter follow-ups** (Phase 7 of `desktop-offline-online-plan.md`):
  - Item images in the offline copy: done. The copy lists them (`GET /fallback/images`); the
    desktop app keeps them in `fallback/images`, fetching each from the server once, and puts
    them back after every refresh (which replaces the copy's uploads).
  - Settling credit sales, returns and adding customers offline: moved to item 17 (each needs
    its own design).
  - A conflict screen when a sync is refused: done. Before adding anything, the server checks
    for invoice and receipt numbers it already used for something else, and for items, customers
    and staff it no longer has; it answers 409 `FALLBACK_SYNC_CONFLICT` with each clash. The
    banner lists them and can save the offline sales to a file for support. Items, customers and
    staff are never deleted through the app, so in practice the clash is a number used twice.
  - Expected and counted cash for a register the sync closes: done. It gets its expected cash;
    the count stays empty and Open Register shows "cash not counted (… expected)".
  - Server reachability in the background: done. Every online computer asks `/meta` every 30
    seconds, so the banner shows before a request fails, and "Send offline sales" shows once the
    server is back.
- **Verified in the desktop app** (Xvfb, from source, as a non-root user, local online API,
  Playwright over CDP): the server stopped with no request from the page and the banner showed
  after 26 s; sold offline with the item picture shown from the copy; an online invoice given
  the offline sale's number made the sync refuse with that clash listed; with the number given
  back, the sales went in.

## [x] 13. Hosting kind: managed or self-hosted (do first)

- **Why:** billing, plan limits and the screens around them apply only to our managed server.
  The server has to say which one it is (see "Hosting modes").
- **What:**
  - API: `POS_HOSTING` (`managed` | `self`, default `self`) read in `apps/api/src/app-config.ts`,
    online mode only. `GET /meta` (`apps/api/src/meta/meta.service.ts`) returns `hosting`; add
    it to the meta contract in `packages/contracts`.
  - Desktop: `checkOnlineServer` (`apps/desktop/src/main.ts`) already reads `/meta`; keep its
    `hosting` in the config store and refresh it at each later `/meta` check. Pass it to the page
    with the rest of `desktop.config`.
  - Web: a small helper (`isManagedHosting()`) the billing screens of item 14 use.
  - Our server: `POS_HOSTING=managed` in the API's `.env`; add it to README.md ("Hosting the
    online server") and `apps/api/.env.example`.
- **Done when:** `/meta` on `pos.hackd.in` says `managed`, a local online API says `self`, and the
  desktop app shows which one it is connected to (e.g. in Settings → About).
- **Status (2026-10-03):** built. `posHosting()` in `apps/api/src/common/mode.ts` (checked at
  startup), `hosting` in `/meta` (optional in the contract, so older servers still parse); the
  desktop app saves it on connecting, after a move online and at each launch
  (`checkServerDetails`), and the page gets it with `desktop.config`. Web: `useHosting()` and
  `useIsManagedHosting()` in `apps/web/src/lib/mode.ts`, preferring the server's own `/meta` and
  falling back to the app's saved value (a fallback counter's local copy answers as offline).
  Settings → Business shows a "Server" card. Tests in `online-mode.test.ts` and `offline.test.ts`.
  Verified in the desktop app (Xvfb, from source, local online API): choosing the server saved
  `managed`, Settings said "our hosted service"; with `POS_HOSTING` removed and the app
  relaunched, the saved value and the card turned to self-hosted. Not checked in Electron: a
  fallback counter while the server is down.
  - [x] On `pos.hackd.in`: add `POS_HOSTING=managed` to `/opt/pos/apps/api/.env` with the deploy
        of this change, then check `curl https://pos.hackd.in/meta` says `"hosting":"managed"`.

## [~] 14. Managed hosting: subscriptions and payments

- **Why:** the managed server is running, but nothing charges for it. `Business.status` has
  `SUSPENDED`, which today refuses sign-in outright (`apps/api/src/tenancy/tenancy.service.ts`).
- **Depends on:** 13, and the "Pricing and limits" and "Payment provider" decisions.
- **What:**
  - **Plans and subscription state (control schema, `apps/api/prisma/control/schema.prisma`):**
    plans with price and limits (branches, counters); on `Business`: plan, `trialEndsAt`,
    `paidUntil`, a billing status (trial, active, past due, read-only, cancelled) and the
    provider's customer and subscription ids. New businesses and businesses that move online
    start on the trial.
  - **Paying:** the owner starts payment from the app; the provider's hosted checkout opens in
    the system browser, not inside the app window. The server never trusts the app's word that a
    payment went through: a webhook endpoint checks the provider's signature, handles each event
    once (keyed by event id) and updates `paidUntil` and the status.
  - **Limits:** creating a branch or counter checks the plan (managed hosting only; offline keeps
    its own limit, self-hosted has none). After a downgrade, existing branches and counters keep
    working but no new ones can be added until the business is within its plan.
  - **When payment stops:** a grace period with a banner for admins (trial ending, payment
    failed), then read-only. Read-only means staff can still sign in, see sales and reports,
    make GST exports and download their data (item 7), but can't sell or change anything (as the
    offline "archived" state, `apps/api/src/common/instance-status.guard.ts`). Keep `SUSPENDED`
    for a full block (abuse) and keep it separate from read-only for non-payment.
  - **Fallback counter:** sales a counter made while the server couldn't be reached still sync
    when the business is read-only, so no sale is lost.
  - **Screens:** a Billing page for owners (with item 8's owner screens): plan, trial days left,
    next payment, pay or change plan, past invoices. Shown only on managed hosting.
  - **Our GST invoices:** a tax invoice for each payment in our own invoice series, with the
    subscriber's GSTIN when given (so they can claim input tax credit), emailed and downloadable.
  - **Emails:** trial ending, payment received, payment failed, read-only from a given date.
  - **Tests:** webhook signature and replay, plan limits, read-only after the grace period,
    fallback sync while read-only, and none of it on a `self` server.
- **Done when:** a new business gets a trial, pays through the provider's test mode, its
  `paidUntil` moves on from the webhook alone, a missed payment turns it read-only after the grace
  period, and paying again turns it back.
- **Status (2026-10-03):** built with a **dummy gateway** behind a gateway interface, so a real
  one is one new class (README.md, "Subscriptions (managed hosting)"). Code in
  `apps/api/src/billing/`, plans in `packages/contracts/src/billing.ts`, control migration
  `20261015100000_billing` (existing businesses get a 14-day trial from the deploy).
  - Decisions taken for now: plans Starter (1 branch, 2 counters, ₹499/month), Growth (3, 10,
    ₹999) and Business (10, 50, ₹2,499), a year for 10 months' price, prices before GST; trial 14
    days on Growth; grace 7 days; prepaid months or years (no automatic renewal yet); the Billing
    page is a Settings tab for admins (owner screens, item 8, can link to it later); billing is
    enforced only with `BILLING_GATEWAY` set, so `POS_HOSTING=managed` alone changes nothing.
  - Tests: `apps/api/test/billing.test.ts` (hosting rules, limits, trial, the dummy payment end
    to end, bad signatures, retried and short webhooks, failed payments, read-only and paying
    back, reminders, plan change carry-over, invoice numbers and GST split) and
    `packages/contracts/src/billing.test.ts`.
  - Verified in the desktop app (Xvfb, from source, local managed API with the dummy gateway):
    trial shown under Settings → Billing; Pay opened `/billing/pay/<id>` in the system browser;
    paying on the dummy page turned the screen to "paid until" on its own; the invoice opened and
    the owner's "Payment received" email went out; past the grace period the read-only banner
    and the Billing tab said so.
  - [ ] Pricing decision: replace the placeholder plans and prices.
  - [ ] A real gateway (Razorpay likely): its `PaymentGateway` class, keys in the environment,
        its webhook pointed at `/billing/webhooks/<name>`, then a test-mode payment end to end.
  - [ ] Automatic renewal (the gateway's subscriptions, e.g. UPI AutoPay): each renewal charge
        arrives as another `payment.succeeded` for a new checkout.
  - [ ] Our seller details for invoices (`BILLING_SELLER_*`) and the SAC code.
  - [ ] **Before turning billing on** (setting `BILLING_GATEWAY` on the server): raise
        `MIN_CLIENT_VERSION` to the first release with the billing screens (0.1.2). Older apps have
        no Billing tab, so a read-only business on one couldn't pay; turned away, they update
        first.
  - [ ] Not enforced while a fallback counter sells offline: its local copy has no billing, so a
        read-only business could still sell there while the server can't be reached.

## [ ] 15. Self-hosted server (later, after managed hosting)

- **Why:** some businesses want the online server on their own infrastructure. The server code
  is the same; what's missing is the setup and the parts of the app that assume our server.
- **Depends on:** 13, 16, and the "Self-hosting price", "Self-hosting licence" and "Self-hosting
  licence expiry" decisions. Start after item 14 is live.
- **What:**
  - **Built images only:** self-hosters never get the source. A Docker image of the API (with
    the web app and migrations) per release, from the release workflow. Either a private
    registry with a pull login per customer, or public images that are no use beyond one
    business without a licence key.
  - **Bundle and minify the API** in the image (one minified file, e.g. with esbuild; the web
    app is minified already), so the shipped JavaScript is hard to read or patch. Obfuscation
    adds a little more; optional.
  - **Licence key** (`POS_LICENSE`): who it's licensed to, how many businesses the server may
    hold (usually 1), and an expiry if the decision asks for one. Signed with our private key,
    which never goes in the repository or an image; the server checks it with a public key built
    into the code, with no phone-home, so servers without internet keep working. Without a
    valid key, one business only: creating another is refused. `/meta` reports the licensee and
    the app shows "Self-hosted, licensed to …", so a reseller can't quietly brand it as their
    own. A small private tool (kept out of the images) makes and signs keys.
  - **Licence file:** the proprietary licence (EULA) inside the image and shown in the guide;
    the repository gets an "all rights reserved" LICENSE file.
  - **Connecting the app:** a "Use my own server" link on the welcome screen that shows the server
    address box (hidden today whenever `posServerUrl` is set, `WelcomePage.tsx`), and the same
    choice in "Move to online".
  - **First business:** a first-run setup on the server that creates the business and its owner
    (as offline's `POST /setup`), after which sign-up closes; `POS_ALLOW_SIGNUP` reopens it.
  - **Email optional:** without SMTP, owner verification is off and password resets use a
    recovery code, as offline does.
  - **Install:** a `docker-compose.yml` (API, PostgreSQL, an HTTPS proxy such as Caddy) with
    nightly backups, and a self-hosting guide in README.md.
  - **Updates:** upgrade notes per release, the rule that the server updates before the apps,
    and a warning on the server's side when apps newer than it connect.
  - **No billing:** item 14's checks and screens stay off (the billing tables exist but stay
    empty; one schema for every server, decided 2026-10-03).
  - **Honest limits:** shipped JavaScript can still be read and patched by someone determined.
    What stops reselling is the licence (a legal case) together with the key and closed source
    (reselling becomes hard and plainly deliberate).
- **Done when:** someone follows the guide on a fresh VPS with a built image and a licence key,
  connects a desktop app through "Use my own server", sells, backs up and restores, with no
  billing screens shown; a second business is refused without a key that allows it; and a
  tampered or expired key is refused.

## [ ] 16. Closing the source and moving the update feed (before the first real release)

- **Why:** the source is to stay closed (decided 2026-10-03), but this repository is public, and
  the desktop app's updates come from its GitHub Releases (`publish` in
  `apps/desktop/electron-builder.yml`). A private repository's releases can't be read by
  installed apps, so they would never update again.
- **What, in this order:**
  1. **A public place for installers only.** Either a releases-only public repository (e.g.
     `nathgoutam93/pointofsale-releases`; the release workflow publishes there with a token
     secret that can write to it), or our own server or object storage (electron-builder's
     "generic" provider, e.g. `https://pos.hackd.in/updates/`).
  2. **Point the app at it:** `publish` in `electron-builder.yml` and
     `.github/workflows/desktop-release.yml`. Check with a release that an installed app
     finds and installs the next one from there.
  3. **Make this repository private** (GitHub → Settings → General → Danger Zone → Change
     visibility). No real users have the app yet (2026-10-03), so only test installs of 0.1.0
     and 0.1.1 lose their updates; reinstall those. Code already cloned while it was public
     can't be recalled.
  4. **Licence file:** an "all rights reserved" LICENSE in the repository.
- **Done when:** the repository is private, and an installed app updates itself from the new
  place.

## [x] 17. Fallback counter: credit sales, returns and new customers offline

- **Why:** while the server is down the fallback counter sells for cash and card only. Credit
  sales, settling old bills, returns and new customers wait for the server.
- **What (proposal; each part can be done on its own):**
  - **New customers:** made offline with their own ids (UUIDs already), sent first in the sync.
    The server matches a phone number it already has to that customer instead of adding a second
    one, and points the offline invoices at it.
  - **Credit sales:** the copy already has customers' balances as at the last refresh. Offline
    credit sales add to the due; the server's balances follow from the synced invoices. Needs a
    rule for credit limits (item 11) while offline, e.g. offline credit only up to the limit as
    at the copy.
  - **Returns:** credit notes have a series per counter (like invoices), so offline numbering is
    safe. Returns need the original invoice in the copy: only the counter's own recent invoices
    (the last few days) would be in it, so returns of older or other counters' bills still wait.
    Stock and refunds sync like sales.
  - **Settling old bills:** needs the bill's current due, which another till may have changed
    online; least safe offline. Leave it waiting for the server unless a shop asks.
  - Each: its own outbox rows, the server's checks (and clash reasons for item 12's list), and
    tests like `fallback.test.ts`.
- **Done when:** a fallback counter adds a customer, sells to them on credit and takes a return of
  its own sale while the server is down, and all three reach the server correctly.
- **Status (2026-10-04):** built.
  - **The copy** (`FallbackService.snapshot`) now also has:
    - The counter's return series.
    - Its own paid bills from the last 7 days (`FALLBACK_RETURNABLE_DAYS`), with their lines and
      returns, listed in `FallbackCopiedDocument` so they aren't sent back as new.
    - What each customer owed (`FallbackBalance`). The copy holds no unpaid bills, so this is how
      credit limits work offline.
    - Both tables are new (migration `20261016100000_fallback_offline`). They are empty on the
      server and never move with a business.
    - `createBackup` can build a table's rows from a query (`from`).
  - **Offline (local API):**
    - New customers get a code `OFF-xxxxxxxx`.
    - Credit sales are checked against the limit, with what the customer owed at the copy counted
      in.
    - Bills made offline can be paid (part or full).
    - Returns are allowed for bills made offline and the copied ones; refunds are in cash.
    - No wallet payments, wallet refunds or change into a wallet.
    - Editing customers and older or other counters' bills still waits for the server.
  - **Sync (`FallbackService.sync`):**
    - Customers are added with the server's next code and a wallet.
    - One whose phone number the server already has becomes that customer, and the offline bills
      move to them.
    - Returns are checked: their series, their register, and that the bill is the counter's own.
    - Clashes are listed, as for invoices:
      - A return number already used online.
      - Goods also returned online, so more would come back than was sold.
      - More money handed back than was paid.
      - Lowering what is owed on a bill the server had.
  - **Desktop:** the app also notes return numbers issued online, so offline returns carry on
    after them.
  - **Tests:** `fallback.test.ts`.

---

## Progress log

- 2026-10-03: List written.
- 2026-10-03: The fallback counter is done; its follow-ups are under item 12 (then numbered 10).
- 2026-10-03: Item 3 started: the server is up behind HTTPS; deploy and backup scripts added.
- 2026-10-03: The server sends email (Brevo SMTP); deploy.sh used for the first real deploy. Desktop v0.1.0 built for Linux and Windows by the release workflow (draft).
- 2026-10-03: From testing: admins manage any branch without a register (branch selector), cashier permissions, returns on unpaid bills lower the amount due first, cashiers receive transfers at their branch.
- 2026-10-03: v0.1.1 released; the forced update from 0.1.0 (MIN_CLIENT_VERSION) works end to end.
- 2026-10-03: CI added (`.github/workflows/ci.yml`) and `fix/auth-hardening` merged into `main` (#1).
- 2026-10-03: Removed `fix-plan.md` (all done) and `b2b-implementation-plan.md`; added items 10 (B2B GST customers) and 11 (receivables).
- 2026-10-03: Hosting modes decided (offline, managed, self-hosted; the server says which via `POS_HOSTING`). Added items 13 (hosting kind), 14 (managed subscriptions and payments) and 15 (self-hosted, later). Managed hosting comes first.
- 2026-10-03: Item 13 done: servers report `hosting` (managed or self) in `/meta`, the desktop app keeps it, Settings shows it. Left: set `POS_HOSTING=managed` on `pos.hackd.in` at the next deploy.
- 2026-10-03: Item 14 built with a dummy payment gateway (plans, trial, limits, read-only, webhooks, invoices, reminders, Settings → Billing). Left: pricing, a real gateway, renewals, seller details.
- 2026-10-03: Decided: closed source, self-hosters get built images with a licence key. Item 15 rewritten for that; item 16 added (move the update feed, then make the repository private, before the first real release). Product fixes come before selling.
- 2026-10-03: Server deployed with `POS_HOSTING=managed` (no `BILLING_GATEWAY`). Version 0.1.2 prepared to ship the Server card and Billing screens to installed apps.
- 2026-10-03: Item 12 done (receipt builder, transfer destinations, POS email check, and the fallback counter's pictures, sync clashes, uncounted cash and background server check); offline credit, returns and customers moved to item 17.
- 2026-10-04: Item 10 done: registered (B2B) buyers on customers, bills, receipts and GSTR-1 (B2B, CDNR).
- 2026-10-04: Item 11 done: credit limits (cashiers stopped, admins warned), payment terms and due dates, overdue marks, statements (printed and emailed) and ageing.
- 2026-10-04: Item 17 done: offline customers, credit sales (within the limit as copied), payments on offline bills and returns of recent own bills, all synced.
- 2026-10-04: Item 7 done: Settings → Your data downloads the whole online business (restorable offline) and a sales register CSV.
- 2026-10-04: Item 8 done: the owner's screen (/owner) lists each business's staff, gives new passwords and turns staff off or on.
- 2026-10-04: Item 1 done: crash reports to our own server (desktop main, local API, page, online API), scrubbed, sent only after an admin says yes.
- 2026-10-04: Version 0.1.3 prepared: ships items 10, 11, 17, 7, 8 and 1 to installed apps. Deploy the server first (two new migrations). Then set `MIN_CLIENT_VERSION=0.1.3`: a 0.1.2 fallback counter can't load the new offline copy (it lacks the migration) and its offline sales are refused until it updates.
- 2026-10-04: Codebase audit written up in `pre-launch-audit.md`; all of it is needed before launch.
- 2026-10-05: Version 0.1.4 prepared: ships the pre-launch audit (pre-launch-audit.md A–E: UPI, cash and change, round-off, barcodes and scale labels, reports, audit log, suppliers and purchase GST, batches and expiry, A4 invoices, cost hiding, business deletion, low stock, cash in/out and expenses, barcode labels, size/colour variants, item import). Deploy the server first (18 new migrations, and one on the control schema). Then set `MIN_CLIENT_VERSION=0.1.4`: a 0.1.3 fallback counter can't load the new offline copy (new tables and migrations) and its offline sales are refused until it updates.
- 2026-10-06: Version 0.1.5 prepared: ships the guided screen tours (a tour on each screen the first time it's opened, with GIFs of the clicks, and a ? button to see it again). Web app only: no migrations, so the server needs no deploy first and `MIN_CLIENT_VERSION` stays as it is.
- 2026-10-07: Version 0.1.6 prepared: ships the retail POS fixes (retry-safe payments, round-off on returns, offline batches and drawer cash, unregistered shops; see retail-pos-fix-plan.md). Deploy the server first (four new migrations). Then set `MIN_CLIENT_VERSION=0.1.6`: settlement now needs an operation ID that 0.1.5 clients don't send, and a 0.1.5 fallback counter can't load the new offline copy. Registered shops without a GSTIN are asked to enter it or turn Unregistered before they can bill.
