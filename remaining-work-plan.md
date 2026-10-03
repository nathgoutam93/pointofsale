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
- **Browser use:** should online businesses also use the web app in a plain browser? It works
  today if the web app and API are on the same site with the web app in `CORS_ORIGINS`.
- **After moving online:** how long to keep the computer's read-only copy, and whether to offer
  deleting it.
- **Pricing and limits:** plans for managed hosting: price per month and year, how many branches
  and counters each allows, trial length (needed for item 14).
- **Payment provider:** for managed hosting subscriptions. Razorpay Subscriptions is the likely
  choice (INR, UPI AutoPay, cards) (needed for item 14).
- **Self-hosting price:** free, a license key the server checks, or a one-time fee with paid
  support (needed for item 15, later).

---

## Hosting modes (decided 2026-10-03)

The product comes in three forms:

1. **Offline:** one branch, one counter, everything on one computer, with local backups the owner
   controls (number of days, a second folder). Built; see the desktop app in README.md.
2. **Managed hosting:** our server, `pos.hackd.in` today (the address may change). Businesses
   sign up, get a trial and pay a subscription. **This comes first** (items 13 and 14).
3. **Self-hosted:** a business runs the online server on its own infrastructure, with more
   setup on their side. **Later**, once managed hosting is taking payments (item 15).

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

Order of work: 13, then 14. Before charging anyone, also finish the rest of item 3 (off-server
backups, a practised restore, uptime monitoring) and item 7 (data export), which paying
customers expect. Item 15 comes after that.

---

## [ ] 1. Crash reporting

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

## [ ] 7. Data export for online businesses

- **Why:** offline businesses have backups; an online owner can't download a copy of their own
  data (and may need one to leave, or for their accountant).
- **What:** an owner-token endpoint that streams the business's tables (the migration bundle
  format, `ExportService`, already does this for offline businesses) plus a readable CSV
  option for sales and GST. A button in Settings for admins, or the owner screens.
- **Done when:** an owner downloads a complete copy and it can be restored into an offline install.

## [ ] 8. Owner screens

- **What:**
  - A screen for owners (owner sign-in) listing their businesses and each business's staff, to
    reset passwords or deactivate staff there instead of through "Forgot your password?".
  - Invites, if joining by business code turns out not to be enough.
- **Done when:** an owner manages staff of every business from one place.

## [ ] 9. Real hardware

- **What:**
  - Receipt printing, the cash drawer kick and the bill-number barcode on real thermal printers
    (Epson, TVS, Xprinter), on Windows and Linux.
  - Scan a printed barcode on the Returns screen.
  - So far only a printer that saves PDFs has been used.
- **Done when:** each works on at least two printer brands.

## [ ] 10. B2B GST customers (registered buyers)

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

## [ ] 11. Receivables: credit limits, due dates, statements

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

## [ ] 12. Smaller follow-ups

- **Receipt builder:** the Sales screen still builds its receipt from its own line mapping;
  switch it to `invoiceReceiptItems` (`packages/contracts/src/receiptDocuments.ts`), which
  emailed receipts already use, so the two can't drift.
- **Transfers by cashiers:** a cashier allowed to send transfers picks the destination from the
  branches they have access to; list every branch of the business there instead.
- **POS check:** look at the POS screen's "Email the receipt" after a sale in the desktop app
  (the same component is checked on the Sales screen).
- **Fallback counter follow-ups** (Phase 7 of `desktop-offline-online-plan.md`):
  - Item images in the offline copy (only logos are copied).
  - Settling credit sales, returns and adding customers offline. Each needs server balances or
    numbering, and its own outbox rows and checks on the server.
  - A conflict screen when a sync is refused (an item or customer deleted online, a number used
    twice), instead of "contact support".
  - Expected and counted cash for a register the sync closes because one was opened offline.
  - Check that the server can be reached in the background, so the banner appears before a
    request fails.

## [ ] 13. Hosting kind: managed or self-hosted (do first)

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

## [ ] 14. Managed hosting: subscriptions and payments

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

## [ ] 15. Self-hosted server (later, after managed hosting)

- **Why:** some businesses want the online server on their own infrastructure. The server code
  is the same; what's missing is the setup and the parts of the app that assume our server.
- **Depends on:** 13, and the "Self-hosting price" decision. Start after item 14 is live.
- **What:**
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
  - **No billing:** item 14's checks and screens stay off; a license check only if the
    self-hosting price decision asks for one.
- **Done when:** someone follows the guide on a fresh VPS, connects a desktop app through "Use my
  own server", sells, backs up and restores, with no billing screens shown.

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
