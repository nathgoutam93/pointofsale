# Remaining work

Written 2026-10-03, after the desktop app, online server, password resets, cookie sessions,
email features and the fallback counter (see `desktop-offline-online-plan.md`). These are left
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

- **Hosting:** provider and domain for the online server (needed for items 3 and 4).
- **Code signing:** Windows and macOS certificates (needed for item 2).
- **Browser use:** should online businesses also use the web app in a plain browser? It works
  today if the web app and API are on the same site with the web app in `CORS_ORIGINS`.
- **After moving online:** how long to keep the computer's read-only copy, and whether to offer
  deleting it.
- **Pricing and limits:** for online businesses (branches, counters).

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

## [ ] 6. CI and merging the branch

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

## [ ] 10. Smaller follow-ups

- **Receipt builder:** the Sales screen still builds its receipt from its own line mapping;
  switch it to `invoiceReceiptItems` (`packages/contracts/src/receiptDocuments.ts`), which
  emailed receipts already use, so the two can't drift.
- **Customer email:** a saved email address on customers, offered when emailing a receipt.
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

---

## Progress log

- 2026-10-03: List written.
- 2026-10-03: The fallback counter is done; its follow-ups are under item 10.
