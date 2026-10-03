# Desktop App Plan: Offline and Online Modes

Plan written 2026-10-03. It turns the POS into a desktop app that either runs fully on one machine (offline mode) or talks to the hosted, multi-business server (online mode), with a one-click move from offline to online.

## How to use this file (for a new session)

1. Read **Goals**, **Decisions** and **Architecture**, then the **Progress log** at the bottom.
2. Pick the first unchecked item whose **Depends on** items are done. Items in different phases that don't depend on each other can be worked in parallel sessions (for example Phase 3 and Phase 4).
3. Check the code before changing it. File paths and line numbers were correct on 2026-10-03 but may have moved.
4. Work on a feature branch per phase (suggested names are given with each phase), not on `main`.
5. Before committing, run `pnpm --filter @pos/api typecheck`, `pnpm --filter @pos/web typecheck` and the tests for anything you touched (`pnpm --filter @pos/api test` needs PostgreSQL, see `README.md`).
6. Tick the box, then add a line to the **Progress log** saying what changed, what's left and any decision you made. If you change a decision, update the **Decisions** section too.
7. Dependencies: `pnpm install` at the repo root, then `npx prisma generate` in `apps/api`.

Status key: `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` dropped (say why)

---

## Goals

1. **First launch: pick a business type.**
   - "Single shop, one counter": works fully offline and never needs the internet.
   - "Several counters or branches": the app tells the user that this needs an internet connection and an online account, then creates the business online or joins an existing one.
2. **API calls follow the mode.** Offline mode talks to the API running in the background on the same machine. Online mode talks to the hosted API.
3. **Move online at any time with one button.** All local data is pushed to a new online business, then the app switches to online mode.
4. **Check for updates every day.** The app, its local database schema and its API always match the hosted server, so moving online always works and online calls never hit an outdated client.

## Decisions

| # | Decision | Why |
|---|----------|-----|
| D1 | **Electron** desktop app in `apps/desktop`, packaged with `electron-builder`. | The API is Node/NestJS and runs unchanged inside Electron's Node runtime. Single-file packers (`pkg`, Node SEA) struggle with Prisma's engine files and a bundled database. |
| D2 | **Real PostgreSQL bundled with the app** (`embedded-postgres` npm package), not SQLite. | The code depends on Postgres: `FOR UPDATE` row locks, `pg_advisory_xact_lock`, Postgres enums, exact `Decimal` money values, Postgres-only raw SQL, and 30+ Postgres migrations. One schema and one migration set serve both modes. |
| D3 | **Schema-per-business** on the hosted server, plus a shared `control` schema (businesses, accounts, memberships). | Business code stays unchanged; each business is one schema created from the same migrations as the desktop database. |
| D4 | **Offline is limited to 1 branch and 1 counter**, enforced in the API, not only hidden in the UI. | This is the product rule. It also keeps the move online simple. |
| D5 | **The move online is one-way.** After a successful push, the local database becomes a read-only archive. | Prevents sales made on the old local copy from never reaching the cloud. No two-way sync. |
| D6 | **The push uploads a data bundle (rows as JSON), not a `pg_dump`.** | A `pg_dump` file is SQL. Restoring client-supplied SQL on the shared server would let a tampered client run arbitrary SQL against other businesses. The server inserts rows itself into a fixed list of tables. |
| D7 | **The web UI is always loaded from inside the app** (custom `app://` protocol), in both modes. Only the API base URL changes. | One UI build, one code path. Online mode doesn't depend on a hosted website being up. |
| D8 | **Single version line.** Desktop app version = API version = schema version (the latest migration name). The hosted API publishes the minimum client version it accepts. | That lets "stay in sync" be checked mechanically. |
| D9 | **Daily update check** with `electron-updater` (at launch and every 24 h), feeding from GitHub Releases. An update below the server's minimum client version is **required**; others install on the next restart. | Goal 4. |

## Architecture

```
┌──────────────────────── Desktop app (Electron) ─────────────────────────┐
│ main process                                                            │
│  ├─ config store  (userData/config.json: mode, apiBaseUrl, businessId)  │
│  ├─ updater       (electron-updater, daily)                             │
│  ├─ OFFLINE only: embedded Postgres  (userData/pgdata, 127.0.0.1:rand)  │
│  ├─ OFFLINE only: local API process  (apps/api/dist, 127.0.0.1:rand)    │
│  │                 runs `prisma migrate deploy` before starting         │
│  └─ app:// protocol serves apps/web/dist (SPA fallback to index.html)   │
│ preload  → window.posDesktop { getConfig, setupOffline, goOnline, ... } │
│ renderer → apps/web; api base URL = posDesktop.getConfig().apiBaseUrl   │
└─────────────────────────────────────────────────────────────────────────┘
          offline: http://127.0.0.1:<port>      online: https://api.<domain>
                                                        │
┌──────────────────────── Hosted API (same apps/api) ───┴──────────────────┐
│ control schema: Business, Account, Membership, Invite, ImportJob         │
│ tenant schemas: tenant_<id> (same Prisma schema and migrations)          │
│ request → token claim `bid` → PrismaClient for that schema (cached)      │
│ PgBouncer (transaction mode) in front of Postgres                        │
└──────────────────────────────────────────────────────────────────────────┘
```

The same `apps/api` code runs in both places. `POS_MODE=offline` or `POS_MODE=online` switches the few behaviours that differ.

---

## Phase 1: API changes shared by both modes

Branch: `feat/desktop-api-modes`. Everything here can be tested in a browser with `pnpm dev`, without Electron.

### [x] 1.1 Mode and runtime config
- **Where:** `apps/api/src/main.ts`, new `apps/api/src/common/mode.ts`, `apps/api/.env.example`.
- **What:** Read `POS_MODE` (`offline` | `online`, default `online` so existing setups don't change), `HOST` (offline: `127.0.0.1` only), `PORT` (`0` = random, print the chosen port as one JSON line on stdout so Electron can read it), `UPLOADS_DIR` (already exists). Export `isOffline()`.
- **Done when:** `POS_MODE=offline PORT=0 node dist/main.js` listens on 127.0.0.1 only and prints `{"event":"listening","port":NNNNN}`.

### [x] 1.2 Version endpoint
- **Where:** new `apps/api/src/meta/meta.controller.ts`, contract in `packages/contracts/src/index.ts`.
- **What:** `GET /meta` (public) returns `{ appVersion, schemaVersion, mode, minClientVersion, setupRequired }`.
  - `appVersion` comes from a shared version constant (see 6.1).
  - `schemaVersion` is the latest applied migration name, read from `_prisma_migrations`.
  - `minClientVersion` comes from env (online only).
  - `setupRequired` is true when there are no users (offline only).
- **Done when:** the web app and Electron can call it before sign-in.

### [x] 1.3 First-run setup replaces the random-password seed (offline)
- **Where:** `apps/api/src/auth/auth.service.ts` (`onModuleInitSeed`, `seedFirstAdmin`), new `POST /setup` route.
- **What:**
  - In offline mode, don't create the admin at startup. `POST /setup` is public **only while no users exist**. It creates in one transaction, under an advisory lock so two calls can't both win:
    - the business settings (name, GSTIN, taxpayer type, state, timezone)
    - branch `MAI` and counter 1
    - the admin user with the password the user typed
  - Online mode keeps today's seed behaviour until Phase 4 replaces it with provisioning.
- **Done when:** a fresh offline database shows the setup screen and no password is printed to logs. A second `POST /setup` returns 409.

### [x] 1.4 Enforce the offline limits
- **Where:**
  - `apps/api/src/branches/branches.service.ts` `createBranch`
  - `apps/api/src/counters/counters.service.ts` `createCounter`
  - `apps/api/src/transfers/transfers.service.ts`
  - the branch price endpoints, if they only make sense across branches
- **What:** In offline mode, refuse a second branch or a second counter with a clear message: "Single-counter businesses can't add branches or counters. Move your business online to add more." Stock transfers need two branches, so refuse them too.
- **Done when:** API tests cover each refusal (run the API with `POS_MODE=offline` in a new test file).

### [x] 1.5 Make advisory lock keys tenant-safe
- **Where:** `apps/api/src/settings/settings.service.ts` lines ~73, ~254, ~298: `pg_advisory_xact_lock(hashtext('taxpayer-type-change'))`.
- **What:** Advisory locks apply to the whole database, not per schema. A constant key would make every business on the server queue behind every other business's settings change. Build the key from the current schema, e.g. `hashtextextended(current_schema() || ':taxpayer-type-change', 0)`. Check every other `pg_advisory_xact_lock` call: the keys built from branch or item UUIDs are already safe.
- **Done when:** grep shows no constant lock keys, and the tests pass.

### [x] 1.6 Data export for the move online (offline only)
- **Where:** new `apps/api/src/migration/export.service.ts`, `GET /migration/export` (admin only, offline only).
- **What:** Stream a zip bundle:
  - `manifest.json`: format version, `appVersion`, `schemaVersion`, `exportedAt`, row count and SHA-256 per table
  - one `tables/<Model>.ndjson` per table, in foreign-key order
  - `uploads/**`
- **Notes:**
  - Keep the table list in one shared constant (`packages/contracts/src/migration.ts`) so export and import agree.
  - Add a test that fails when a model in `schema.prisma` is missing from the list.
  - Export `Decimal` values as strings.
- **Precondition checks** (return 409 with the reason):
  - no open register sessions
  - no checkout in progress
- **Done when:** export → import (5.3) on a test database round-trips every row exactly.

### [x] 1.7 Read-only "archived" state (offline)
- **Where:** `apps/api/src/auth/auth.guard.ts` or a new global guard. The flag lives in a new single-row table `LocalInstance` (`status: ACTIVE | ARCHIVED`, `movedToBusinessId`, `movedAt`).
- **What:** When `ARCHIVED`, every non-GET request returns 423 "This business has moved online." Reports, sales history and GST exports stay readable.
- **Done when:** a test sets the flag and checks that writes are refused and reads still work.

---

## Phase 2: Web app

Branch: `feat/desktop-web-modes`. Depends on 1.1 and 1.2. Most items can be tested in the browser by setting the config by hand.

### [x] 2.1 Runtime API base URL
- **Where:** `apps/web/src/lib/api.ts`. `API_BASE_URL` is also used directly in `BranchSettingsPage.tsx`, `ItemsPage.tsx`, `SalesPage.tsx`, `ReturnsPage.tsx` and `screens/pos/useStoreSettings.ts`.
- **What:**
  - Replace the build-time constant with `getApiBaseUrl()`. It reads `window.posDesktop?.config.apiBaseUrl`, then falls back to `import.meta.env.VITE_API_BASE_URL`, then to `http://localhost:3001`.
  - Create the ts-rest client lazily, or rebuild it when the mode changes.
  - Add `assetUrl(path)` for logo and image URLs, replacing the four copies of the `replace(/\/$/, '')` logic.
- **Done when:** nothing imports `API_BASE_URL`, and switching the config then reloading points every call, upload and image at the new server.

### [x] 2.2 Shared upload helper
- **Where:** the raw `fetch` uploads in `BranchSettingsPage.tsx` (business logo, branch logo) and `ItemsPage.tsx` (item image).
- **What:** One `uploadFile(path, file)` in `lib/api.ts` that uses `getApiBaseUrl()`, adds auth headers and handles 401 like the ts-rest client. This also closes a follow-up listed in `fix-plan.md` item 1.
- **Done when:** all three uploads use it.
- **Done 2026-10-03** as `apiFetch(path, init)` in `lib/api.ts` (with session hardening): the cookie, the session header and the same 401/403/426 handling. Item images are now saved as `/uploads/…` and shown through `uploadSrc()`.

### [x] 2.3 Welcome and business-type screen
- **Where:** new `apps/web/src/screens/onboarding/`. Route guard in `router.tsx`: if `posDesktop.config.mode` is unset, go to `/welcome`.
- **What:** Two choices:
  - **"One shop, one billing counter"**: works without internet. Goes to 2.4.
  - **"More than one counter or branch"**: shows "This needs an internet connection and an online account." Then offers **Create a new business** or **Join an existing business** (2.5).
  - Also include a small "Already moved online? Sign in" link.
- **Done when:** the choice is saved through `posDesktop.setMode(...)` and the app restarts into that mode.

### [x] 2.4 Offline setup form
- **Depends on:** 1.3, 3.4.
- **What:** Business name, GSTIN (optional), taxpayer type, state, timezone, admin username and password (entered twice). Calls `POST /setup` on the local API, then signs in.
- **Done when:** a fresh install reaches the POS screen with no terminal output needed.

### [x] 2.5 Online create or join
- **Depends on:** 4.5.
- **What:**
  - **Create:** owner account (email, password, email code), business details, then the business is created on the server, then sign in.
  - **Join:** the business code or invite code from an admin, plus username and password, then sign in.
  - Save `{ mode: 'online', apiBaseUrl, businessId, businessCode }` in the config.
- **Done when:** a second machine can join a business made on the first.

### [x] 2.6 Hide what offline mode can't do
- **Depends on:** 1.2.
- **Where:** `AppLayout.tsx` nav (`/transfers` is at line ~50), branch and counter settings, branch price screens.
- **What:** When `mode === 'offline'`:
  - hide Transfers, "Add branch" and "Add counter"
  - show a short "Need more counters? Move online" hint linking to 2.7
- **Done when:** none of the actions refused by 1.4 can be reached from the UI.

### [x] 2.7 "Move to online" button
- **Depends on:** 1.6, 5.x.
- **Where:** Settings (admin only, offline only).
- **What:** One button, then a dialog with steps:
  1. Check internet and server version. If out of date, run the required update first (6.3).
  2. Sign in or create the online owner account.
  3. Check that no register is open (offer to close it).
  4. Export.
  5. Upload with a progress bar.
  6. Wait while the server imports.
  7. Show the result.
  8. Switch to online mode, restart and sign in.

  Every step can be retried, and a failure leaves the local business fully working (see 5.4).
- **Done when:** one click (plus sign-in) moves a demo-seeded business online with identical totals in Reports.

### [x] 2.8 Update notices
- **Depends on:** 3.5.
- **What:** A banner for "Update ready — restart to install". A blocking screen for "This version is no longer supported — updating…" when below `minClientVersion`.

---

## Phase 3: Desktop app (Electron)

Branch: `feat/desktop-shell`. Can run in parallel with Phase 4.

### [x] 3.1 Scaffold `apps/desktop`
- **What:**
  - Electron main, preload and `electron-builder` config. The build depends on `@pos/web` and `@pos/api` building first (add it to `turbo.json`).
  - Register a privileged `app://` scheme that serves `apps/web/dist` with SPA fallback. TanStack Router uses browser history, so `file://` won't work.
  - Set a strict CSP: `connect-src` allows only the local API and the hosted API domain.
- **Done when:** `pnpm --filter @pos/desktop dev` opens the web app in a window.

### [x] 3.2 Embedded PostgreSQL
- **What:**
  - Use `embedded-postgres`. Data lives in `userData/pgdata`, Postgres listens on 127.0.0.1 on a free port, and the database password is random, generated on first run and stored in `userData/config.json`.
  - Run `initdb` on first run, start on launch and do a clean stop on quit.
  - On a crash, restart once, then show an error with "open logs".
- **Done when:** the database survives an app restart and a forced kill.

### [x] 3.3 Local API process
- **What:**
  - Bundle `apps/api/dist`, its production `node_modules`, and the Prisma query and schema engines for each target platform (set `binaryTargets` in `schema.prisma`).
  - On launch:
    1. Back up the database (3.6) if a migration is pending.
    2. Run `prisma migrate deploy`.
    3. Start the API with `utilityProcess.fork`, passing `POS_MODE=offline HOST=127.0.0.1 PORT=0 DATABASE_URL UPLOADS_DIR=userData/uploads AUTH_SECRET`.
    4. Read the port from stdout (1.1).
    5. Wait for `GET /meta`.
  - `AUTH_SECRET`: 48 random bytes generated on first run and stored in config.
  - Logs: `userData/logs/api.log`, rotated.
- **Done when:** the offline app starts end to end on a machine without Node or Postgres installed.

### [x] 3.4 Config store and preload bridge
- **What:**
  - `userData/config.json` holds `{ mode, apiBaseUrl, businessId, businessCode, onboardedAt }`.
  - The preload exposes only `window.posDesktop`: `config`, `setMode`, `restart`, `getVersion`, `exportForMigration`, `onUpdateStatus`, `installUpdate`.
  - Turn on `contextIsolation` and turn off `nodeIntegration`.
- **Done when:** the web app reads the mode and base URL from `posDesktop.config` (2.1).

### [x] 3.5 Daily update check
- **What:**
  - `electron-updater` with GitHub Releases. Check at launch and every 24 h while the app is running, and download in the background.
  - Before installing, the app checks the server's `GET /meta` `minClientVersion` (online mode, or offline when the internet is available). Below the minimum: block and install now. Otherwise: install on the next restart, never mid-sale.
  - After an update, 3.3 runs migrations on the next start.
- **Done when:** a test release moves an installed app forward and a pending migration is applied.

### [x] 3.6 Local backups (offline)
- **What:**
  - Run a daily `pg_dump` of the local database plus the uploads folder into `userData/backups`, keeping the last 14. Always take one before migrations and before the move online.
  - Settings: "Back up now", "Open backups folder" and "Restore from backup" (with confirmation).
- **Done when:** a restore brings back a deleted sale.

### [~] 3.7 Release pipeline
- **What:**
  - A GitHub Actions matrix (Windows, macOS, Linux) builds installers on a version tag and publishes them to GitHub Releases.
  - Code signing: a Windows certificate, and an Apple Developer ID plus notarization. Without signing, auto-update fails on macOS and SmartScreen warns on Windows.
- **Done when:** tagging `vX.Y.Z` produces signed installers and `latest*.yml` update feeds.

---

## Phase 4: Hosted multi-business server

Branch: `feat/multi-tenant`. Can run in parallel with Phase 3.

### [x] 4.1 Control schema
- **What:** A separate Prisma schema `apps/api/prisma/control.prisma` with its own generated client and its own migrations, living in the `control` Postgres schema:
  - `Business { id, code (short, for joining), name, schemaName, dbServer, status (PROVISIONING|ACTIVE|SUSPENDED), schemaVersion, createdAt }`
  - `Account { id, email, passwordHash, emailVerifiedAt }`
  - `Membership { accountId, businessId, role }`
  - `Invite { code, businessId, expiresAt }`
  - `ImportJob { id, businessId, status, error, counts }`
- **Note:** store `dbServer` now, even with a single server, so businesses can move to a second Postgres server later.

### [x] 4.2 Per-request database client
- **Where:** `apps/api/src/prisma.service.ts`, `auth.guard.ts`, `auth/token.ts`.
- **What:**
  - Keep every service unchanged. `PrismaService` becomes a proxy that hands each call to the client stored in an `AsyncLocalStorage` request context.
  - The guard reads the token's `bid` (business ID) claim, looks up the business, and runs the request inside that context.
  - Clients are cached (LRU with an idle timeout), each with `connection_limit=2` and `pgbouncer=true`.
  - With no business in context, any database call throws. It never falls back to `public`.
  - Offline mode uses one fixed client, unchanged.
- **Done when:** the existing API tests pass in online mode against a provisioned test business.

### [x] 4.3 Business provisioning
- **What:**
  1. `CREATE SCHEMA tenant_<id>`.
  2. Run `prisma migrate deploy` with `DATABASE_URL=...?schema=tenant_<id>`.
  3. Create the business settings, the first branch, counter 1 and the admin user.
  4. Mark the business `ACTIVE`.

  If any step fails, drop the schema and mark the business failed.

### [x] 4.4 Migration runner for all businesses
- **What:**
  - A deploy script that applies migrations to the control schema, then to every business schema with limited concurrency. It records `schemaVersion` per business and stops on the first error.
  - Write migrations as expand/contract (add the new thing, release, then remove the old) so the running API works with both the old and new schema during a rollout.
- **Done when:** deploying a new migration to 50 test businesses finishes, and a forced failure stops and reports which business failed.

### [x] 4.5 Accounts, sign-in and joining
- **What:**
  - Owner signup with an email code, `POST /businesses` (create), and invite and join endpoints.
  - Cashier and admin sign-in becomes `{ businessCode, username, password }`. Extend the `auth.login` contract with an optional `businessCode`, required in online mode. Tokens carry `bid`.
  - Rate-limit sign-in. This is also a `fix-plan.md` follow-up.
- **Done when:** two businesses can each have a user called `admin` without clashing.

### [ ] 4.6 Uploads in object storage
- **What:** Online mode stores uploads in S3-compatible storage under `<businessId>/...` and serves them through signed or proxied URLs. Offline mode keeps the disk folder.

### [x] 4.7 Business isolation tests
- **What:** Two businesses with the same usernames, branch codes and item names. Every endpoint must return only the caller's data, and every `:id` route must return 404 for the other business's IDs.

### [ ] 4.8 Infrastructure
- **What:** Postgres with PgBouncer in transaction mode, automated backups including per-business `pg_dump -n tenant_<id>`, `MIN_CLIENT_VERSION` in the env, and monitoring of connection counts.

---

## Phase 5: Moving a business online

Branch: `feat/go-online`. Depends on 1.6, 1.7, 4.1–4.5.

### [x] 5.1 Bundle format and shared table list
- **What:** `packages/contracts/src/migration.ts` holds:
  - the bundle format version
  - the ordered table list
  - the manifest zod schema

  Both export (1.6) and import (5.3) use it.

### [x] 5.2 Version gate
- **What:** The move is allowed only when bundle `schemaVersion` equals the server's current schema version. Otherwise the server returns 409 `update_required`, the client updates (3.5), restarts and tries again. The local database is never migrated by the server.

### [x] 5.3 Server import
- **What:** `POST /businesses/import` (signed-in owner account, upload limit sized for real shops, streamed to temp storage). Then:
  1. Validate the manifest and checksums.
  2. Provision a new schema (4.3, without the seed rows).
  3. Insert the rows table by table in one transaction from the fixed table list. Unknown files or columns are rejected, never executed.
  4. Copy the uploads to object storage and rewrite logo and image URLs.
  5. Compare row counts against the manifest.
  6. Mark the business `ACTIVE` and link the owner as admin.
- **Rules:**
  - The import is idempotent per `importId`.
  - On any failure, drop the schema.
  - Password hashes come across as they are, so staff keep their passwords.
  - Document number counters come across too, so invoice numbering continues (needed for GST).

### [x] 5.4 Client switch-over and failure handling
- **What:**
  1. Back up locally (3.6).
  2. Lock local writes: set `LocalInstance` to a `MIGRATING` state that blocks writes like 1.7.
  3. Export, upload and poll `ImportJob`.
  4. On success, set `ARCHIVED` with the new business ID, switch the config to online and restart to the sign-in screen with the business code filled in.
  5. On failure or cancel, set the state back to `ACTIVE` and keep working offline.
- **Done when:** killing the network mid-upload leaves a working offline app, and a retry succeeds.

### [x] 5.5 End-to-end test
- **What:** Seed demo data locally (`seed:demo` against an offline instance), move online, then compare totals between the archive and the new online business:
  - Reports totals
  - GSTR-1 and GSTR-3B output
  - stock levels
  - wallet balances
  - next invoice number

---

## Phase 6: Keeping versions in sync

Branch: whichever phase needs it first (likely Phase 1).

### [x] 6.1 One version source
- **What:** The root `package.json` `version` is the single source. A build step writes it into `packages/contracts/src/version.ts`, which the API (`GET /meta`), the web app (About screen) and the desktop app (`electron-builder` uses it) all read.

### [x] 6.2 Release order
- **What:** Write it down in `README.md`:
  1. Deploy the server, including business migrations (4.4).
  2. Publish the desktop release with the same version.
  3. When a release has a breaking API or schema change, raise `MIN_CLIENT_VERSION` on the server. The hosted API must accept the previous client version until then.

### [x] 6.3 Client behaviour on version mismatch
- **What:**
  - **Online:** every response carries an `X-POS-Min-Client` header. If the app is below it, show the blocking update screen (2.8).
  - **Offline:** the daily check (3.5) keeps the app current when the internet is available. Offline-only shops that never connect keep working on their version. The move online (5.2) forces an update first.

---

## Phase 7: Fallback counter (keep selling when the server can't be reached)

**Decided 2026-10-03:** one counter per branch can keep selling when the online server can't be
reached. Its sales are kept on that computer and sent to the server when it's back.

**How it works:**
- **Setting it up:**
  - An admin, on the computer at that counter, turns on "Keep selling here when the server can't be reached" (Settings → Counters, desktop app, online).
  - The server binds the counter to that computer (`Counter.fallbackDeviceId`) and gives the computer a key (`fallbackKeyHash` on the server; the key in the app's config).
  - One fallback counter per branch.
  - Other computers can't open a register on that counter, so its invoice series is only ever issued by this computer.
- **A ready copy:**
  - The computer keeps a local copy of what selling needs, refreshed every 10 minutes while online: settings, the branch, its counters and staff (with password hashes), customers, items and prices, stock, the counter's invoice sequence, and its open register.
  - The copy is the server's own export in the local backup format (`GET /fallback/snapshot`, with the key). It is restored with the existing restore tool into a separate embedded PostgreSQL, under a local API in fallback mode (`POS_FALLBACK=1`).
- **Numbers:**
  - Invoices carry on in the counter's own series (`MAI/1/26/…`): the copy has the series' last number.
  - Receipts use a series of the counter's own (`RCPT-MAI-F1-000001`), continued from `Counter.fallbackReceiptSeq` on the server, so they never clash with the branch's other tills.
- **Switching over (a person decides, never automatic):**
  - When the app can't reach the server, a banner says so.
  - On the fallback computer it offers "Keep selling on this computer". The app then sends the page's requests to the local copy, and staff sign in with their usual username and password.
  - On other computers the banner says selling waits for the server, and which counter can carry on.
- **What works offline:**
  - Selling with cash or card, to walk-in or existing customers.
  - Printing, the cash drawer, opening and closing the register, today's sales list.
  - Not: credit or wallet sales, settling old invoices, returns, new customers, item, stock, settings or staff changes, reports, transfers or purchases. The local API refuses these with "Not while working offline".
- **Going back:**
  - When the server answers again, the banner offers "Send offline sales and go back online".
  - The app stops the page using the local copy and reads everything made locally (`GET /fallback/outbox` on the local API, with a secret only the app knows).
  - It then sends it with the key (`POST /fallback/sync`), and the server inserts it as is: registers, invoices with their lines, discounts and payments, receipts, and stock ledger entries with stock updated.
  - Sync is idempotent: rows are keyed by id, so a retry is safe.
  - The counter's invoice sequence and receipt series move up to the numbers used.
  - The app goes back to the server; the copy refreshes once nothing is left to send.

### [x] 7.1 Server: binding, snapshot, sync
### [x] 7.2 Local API fallback mode (allowed routes, payments, receipt series, outbox)
### [x] 7.3 Desktop: local copy, refresh, switching, sync
### [x] 7.4 Screens: setup in Settings → Counters, the banner, offline sign-in
### [x] 7.5 Tests and an end-to-end run (server stopped mid-day, sales offline, server back, synced)

---

## Open questions (decide before the item that needs it)

- Hosting provider and domain for the hosted API (needed for 4.8 and 3.1's CSP).
- ~~Owner sign-in: email and password with an email code, or phone with OTP? (4.5)~~ Decided 2026-10-03: email and password, with an emailed code the first time an address creates or moves a business.
- Code-signing certificates for Windows and macOS (3.7).
- Should the hosted web app also be usable in a plain browser for online businesses, or desktop only? (Affects 2.1 fallback and CORS.)
- How long to keep the archived local database after a move online, and whether to offer deleting it.
- Pricing or limits for online businesses (number of branches and counters).

---

## Progress log

- 2026-10-03: Plan written. No code changes yet.
- 2026-10-03: **Phase 1 done, plus 6.1** (on `fix/auth-hardening`). 151 API tests and 47 contracts tests pass.
  - **1.1:** `POS_MODE` (default `online`), `HOST`, `PORT=0`. On start the API prints `{"event":"listening","mode":...,"port":N}`. Offline installs bind `127.0.0.1` only, and fail to start if `HOST` is set to anything else.
    - Added beyond the plan, in `src/app-config.ts`: offline installs reject requests whose Host header isn't `127.0.0.1`/`localhost`/`::1` (stops DNS rebinding). CORS is limited by `CORS_ORIGINS`; offline with no list allows only the dev server (`http://localhost:3000`, `http://127.0.0.1:3000`). **Phase 3 must pass `CORS_ORIGINS=<app:// origin>` to the local API.**
    - `.env` now loads before any module (`src/load-env.ts`). Before this, `UPLOADS_DIR` set only in `.env` was ignored by the upload routes.
    - `configureApp()` (CORS, Host check, `/uploads/`) is shared by `main.ts` and the test helper.
  - **1.2:** `GET /meta` (public). `schemaVersion` is the newest applied row in `_prisma_migrations`. `MIN_CLIENT_VERSION` is validated at startup. Also returns `instanceStatus` (offline only), which Phase 2 will need.
  - **1.3:** `POST /setup` lives in `src/setup/`. It's offline only: online answers 404, and a guard checks that before validation runs. It runs under a business lock, refuses with 409 once any user or branch exists, and returns the same session as sign-in. The optional `branchCode` defaults to `MAI`. Choosing composition records a taxpayer type change in force immediately. In offline mode the startup seed creates nothing.
  - **1.4:** `assertOfflineRoomFor()` (`src/common/offline-limits.ts`) runs under a lock inside the create transaction for branches and counters; transfers are refused outright. All answer 403 with a "Move your business online" hint. Branch prices are still allowed: with one branch they're harmless.
  - **1.5:** `lockBusiness(tx, name)` (`src/common/locks.ts`) keys the lock on `current_schema()`. The other advisory locks already use branch or item UUIDs, so they were left alone.
  - **1.6:** `GET /migration/export` (admins, offline only). Refused (409) while a register is open or once `ARCHIVED`. All rows are read in one REPEATABLE READ transaction and written to temp files first, so errors still come back as normal HTTP errors; then the zip is streamed with `manifest.json` last. Single-key tables are paged by key, composite-key tables by offset.
    - The table list is `MIGRATION_TABLES` in `packages/contracts/src/migration.ts`. A test fails if a Prisma model is neither listed nor in `MIGRATION_EXCLUDED_MODELS`, or if a table comes before one it references.
    - Uses `archiver@7`: version 8 is ESM-only, and the API is compiled as CommonJS.
  - **1.7:** new `LocalInstance` model and migration `20261006100000_local_instance`, with status `ACTIVE | MIGRATING | ARCHIVED` (no row = ACTIVE). `InstanceStatusGuard` runs after `AuthGuard` and answers 423 to writes in offline mode only. `@AllowWhenLocked()` exempts a route; sign-in uses it. Nothing sets the status yet: that comes in 5.4.
  - **6.1:** the version is `0.1.0` in the root `package.json` and `APP_VERSION` in `packages/contracts/src/version.ts`, and a contracts test keeps them equal. It's not generated by a build step, so there's no generated file to keep in sync.
  - **Tests:** `test/offline.test.ts` runs on its own database, `pos_offline_test`, reset from the migrations each run (same rule as `pos_test`: the name must contain "test"). `test/online-mode.test.ts` covers the online side and the export table list.
  - **Next:** Phase 2 (web) or Phase 3 (desktop shell); they don't depend on each other.
- 2026-10-03: **Desktop app (Phase 3), plus the web items it needs (2.1, 2.3, 2.4).** On `fix/auth-hardening`. Phase 2 was reordered at the user's request: the desktop app comes first, so only the web changes it can't run without were done.
  - **Tested on Linux, from source and as the packaged app**, with Playwright driving Electron under Xvfb as a non-root user. First launch → welcome → offline → setup → open-register screen; quit (Postgres stops cleanly, no `postmaster.pid` left); relaunch → straight back in. About 2.5 s from choosing offline to the setup form; about 1.3 s to relaunch. The test script isn't in the repo yet (it was a one-off in the session scratchpad); adding it as `apps/desktop/e2e` is a good follow-up. **Windows and macOS builds are untested.**
  - **Web (2.1):** `apps/web/src/lib/desktop.ts` types the preload bridge (`window.posDesktop`). `API_BASE_URL` in `lib/api.ts` comes from the bridge when present, else from the build as before. It's still a constant, because switching mode reloads the window, so the other files didn't change. 2.2 (shared upload helper) wasn't needed for this and is still open.
  - **Web (2.3, 2.4):** `/welcome` (desktop only, until a mode is chosen) and `/setup` (whenever `GET /meta` says `setupRequired`, so it also works in a browser against `POS_MODE=offline`). Both are in `screens/onboarding/`. The "More than one counter or branch" option asks for the **server address** and checks its `/meta` (mode online, `minClientVersion`); creating or joining a business there waits on Phase 4 (2.5).
  - **3.1:** `apps/desktop`, an ESM main process (`src/main.ts`) and a sandboxed CommonJS preload (`src/preload.cts`). The web build is served at `app://pos/` with SPA fallback and a CSP whose `connect-src`/`img-src` allow only the current API (`src/protocol.ts`). Navigation away, pop-ups and webviews are blocked; the window runs a single instance.
  - **3.2:** Postgres 16 binaries come from the `@embedded-postgres/<platform>` packages (optional dependencies; pnpm installs the one for this machine). The `embedded-postgres` wrapper itself is **not** used: it runs binaries from inside `app.asar` and force-kills Postgres on Windows. `src/postgres.ts` runs `initdb` into a temporary folder then renames it, so a failed first run leaves nothing behind. `pg_ctl` starts and stops the server on a free port on 127.0.0.1, with scram-sha-256 and a random password. It stops a server left over from a crash before starting. The app uses the default `postgres` database.
  - **3.3:** `prisma migrate deploy` runs on every launch, as a child process of the app's own binary with `ELECTRON_RUN_AS_NODE=1`. A utility process can't be used: the Prisma CLI never exits in one, because the link to the parent keeps it alive. **If the RunAsNode Electron fuse is ever turned off, migrations break.** The API runs as an Electron utility process with `POS_MODE=offline`, `PORT=0`, `CORS_ORIGINS=app://pos`, uploads in userData, and a cwd of userData so no stray `.env` is read. Only a few environment variables are passed through. `prisma` moved to the API's `dependencies` for this.
  - **3.4:** `userData/config.json` (mode 0600) holds `mode`, `apiBaseUrl`, `dbPassword` and `authSecret`. The secrets are saved *before* `initdb`. The bridge exposes only `config` (mode and API URL), `version`, `chooseMode` and `openLogsFolder`; the page never sees the secrets. Logs are in `userData/logs/{main,postgres,migrations,api,updater}.log`. A startup failure shows a dialog with Restart / Open logs folder / Quit.
  - **3.5 (partly):** `electron-updater` checks at launch and every 24 h when packaged, downloads in the background and installs on quit. It reads GitHub Releases (`publish` in `electron-builder.yml`). **Not done yet:** forcing an update when the server's `minClientVersion` is newer (6.3), and the update banner (2.8).
  - **3.7 (partly):** `apps/desktop/scripts/stage.mjs` builds everything and fills `apps/desktop/stage/`:
    - `api`: `pnpm deploy --prod` with a hoisted `node_modules` and a generated Prisma client; the API's `package.json` `files` keeps out `.env` and sources
    - `web`
    - `postgres`: binaries with symlinks resolved

    `scripts/after-pack.cjs` copies those into the app's resources, because electron-builder's `extraResources` always drops `node_modules`. `electron-builder.yml` builds AppImage, NSIS and dmg+zip. `.github/workflows/desktop-release.yml` builds on Linux, Windows and macOS on a `v*` tag and publishes to GitHub Releases. **Not done yet:** signing certificates (repo secrets `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_*`), app icons, and a first real release.
  - **Versions:** `apps/desktop/package.json` version must equal `APP_VERSION`; the contracts test now checks it too.
  - **Gotchas:**
    - pnpm didn't run Electron's download step here. If `apps/desktop/node_modules/electron/dist` is missing, run `node node_modules/electron/install.js` inside the electron package.
    - Postgres refuses to run as root. In a root-only container, run the app as another user, with `--no-sandbox`.
  - **Next:** 3.6 backups; 2.6 hide Transfers / add branch / add counter offline (still visible in the menu; the API refuses them); 2.8 update banner and 6.3 forced updates; app icons and signing; then Phases 4 and 5.
- 2026-10-03: **2.6 done, but not by hiding** (the user's call): offline businesses still see Transfers, Create Branch and Add Counter, each with an **"Online only"** badge.
  - Clicking Create Branch or Add Counter opens a "move online" prompt (`GoOnlineDialog`), and the Transfers page shows the same explanation in place of its content (`GoOnlinePanel`). Both are in `apps/web/src/components/OnlineOnly.tsx`.
  - The mode comes from `useIsOffline()` in `apps/web/src/lib/mode.ts`: the desktop bridge when present, else `GET /meta`.
  - The prompt says moving online in one step is coming in an app update. **When 2.7 lands, add its "Move business online" button to that prompt** so it leads straight into the move.
  - Checked in the desktop app under Xvfb (menu badge, Transfers page, both prompts).
- 2026-10-03: **3.6 Local backups done.** Settings → Backups (desktop app, offline mode, admins only): keep **2–5 days** (default 3), Back up now, Restore, Open backups folder.
  - **Format.** The bundled Postgres has no `pg_dump`, so `apps/api/src/backup/local-backup.ts` writes the backup:
    - a zip with `manifest.json` (kind `pos-local-backup`, `schemaVersion`, sha256 per file)
    - one `tables/<table>.ndjson` per table, every row as Postgres's own `row_to_json` text
    - `uploads/**`

    Rows are read with a cursor inside one REPEATABLE READ transaction, so selling continues during a backup. The table list comes from `information_schema`, not Prisma, so an older database can be backed up by a newer app (needed for the before-update backup).
  - **Restore** (`restoreBackup`). The live data is untouched until the final swap:
    1. Check every checksum.
    2. Create `<db>_restore` from template0.
    3. `prisma migrate deploy` with only the migrations up to the backup's `schemaVersion`.
    4. Empty the tables (some migrations insert rows, such as the default business settings).
    5. Load each table with `json_populate_recordset` under `session_replication_role = replica`, then compare row counts.
    6. Swap the databases by renaming, and swap the uploads folder.

    The desktop app's normal start then migrates the restored database forward. A backup whose `schemaVersion` this app doesn't ship (made by a newer version) is refused.
  - **CLI.** `apps/api/src/backup/cli.ts` (`backup`, `restore`, `list`, `prune`) prints a final `{"ok":...}` line. The desktop runs it with its own binary as Node (`runScript` in `api-server.ts`, shared with migrations).
  - **Desktop** (`apps/desktop/src/backups.ts`, `main.ts`):
    - Backups live in `userData/backups`, named `pos-backup-YYYY-MM-DD-HHMMSS-<reason>.zip`, with reason daily, manual, before-update or before-restore.
    - On start: a backup if today's is missing **or** the next migrations would change the database (before-update). A failed backup is logged, never blocking.
    - While running: an hourly check for today's backup.
    - Restore: a before-restore backup, stop the API, restore, start the API (migrations included), clear the session, reload at sign-in.
    - Operations run one at a time.
  - **Retention:** keep backups dated within the last N days; the newest is always kept. `backupDays` lives in `config.json`.
  - **Security:**
    - Every backup IPC call carries the page's token, and the main process asks the local API `/auth/me` for role ADMIN. Restore only accepts a file name from the list.
    - DevTools are off in packaged builds, so a cashier can't call the bridge from a console.
  - **Tests:** `apps/api/test/local-backup.test.ts`, on its own database `pos_backup_test`:
    - an exact round trip (money to the paisa, passwords, uploads; data added after the backup is gone)
    - a damaged file is refused with the data untouched and no leftover database
    - a backup at the previous migration restores, then migrates forward
    - a backup from a newer app is refused
    - retention rules
  - **Verified in the desktop app**, from source and packaged, under Xvfb: daily backup at start, set 2 days, back up now, add an item, restore, signed out, item gone, before-restore backup listed.
  - **Also fixed:** `test/offline.test.ts` assumed which of two simultaneous setup calls wins; it now accepts either (it had passed by luck).
  - **Not done:** copying backups somewhere other than this computer (USB, cloud folder) is manual, and the screen says so. An option to choose a backup folder would be a good follow-up.
- 2026-10-03: **Forced updates and the update banner done (2.8, 6.3, finishing 3.5; 6.2 is written into the README).**
  - **Server:** the desktop app sends `x-pos-client-version` with every request (`CLIENT_VERSION_HEADER` in contracts). In online mode with `MIN_CLIENT_VERSION` set, an older version gets **426** `{ message, minClientVersion }` from a middleware in `app-config.ts`. `/meta` stays open, and requests without the header (browsers, which load the server's own web app) pass. `isOlderVersion` in contracts compares numerically (0.9 < 0.10).
  - **Desktop:** `src/updater.ts` (`Updater` class) tracks `{ state: idle|checking|none|downloading|ready|error|unsupported, availableVersion, percent, error, required }` and pushes every change to the window (`pos:update-status`). It finds out an update is required in three ways:
    - at launch in online mode, `GET /meta`
    - when connecting to a server on first launch (the app connects anyway, then updates)
    - any 426, reported by the page through `updates.require(min)`

    While an update is required it checks right away and every 15 minutes until a new enough version is downloaded. `installNow()` **stops the API and Postgres first** (an installer can't replace files they hold), then `quitAndInstall`. Normal quit still installs on close. When run from source the state is `unsupported`.
  - **Web:** `components/UpdateNotices.tsx` is mounted at the root (`main.tsx`), so it shows over every page, sign-in included.
    - **Required:** a blocking screen showing download progress, then **Restart and update**. If the download fails or the release isn't out yet, it says so and offers **Try again now**. In a browser it shows **Reload**.
    - **Otherwise, once downloaded:** a bottom-right card "Version X is ready", with **Restart now** or **Later** (hides it until the next version).
  - **Verified for real** with two AppImages built from this code (0.1.0 and 0.2.0) and a local update server (a generic provider via a test copy of `electron-builder.yml`):
    - **Online, server requiring 0.2.0:** 0.1.0 showed "Update required", downloaded, Restart and update replaced the AppImage, and it relaunched as 0.2.0.
    - **Offline, no minimum:** the banner appeared and Later hid it. Closing the app installed 0.2.0 with Postgres stopped cleanly, and the next start ran 0.2.0 with the business intact.
  - **Bug found and fixed:** after installing on close, the AppImage updater runs the new version with `APPIMAGE_EXIT_AFTER_INSTALL=true` and waits for it. The app must exit at once (`main.ts`, first lines); before the fix it started up fully. In this container (no FUSE, so `APPIMAGE_EXTRACT_AND_RUN=1`) the updater still logs `ENOBUFS`, because extract-and-run prints every file name. The install itself succeeds; on a normal Linux desktop that output doesn't happen.
  - **Not verified:** Windows (NSIS) and macOS install flows, and a real GitHub Releases feed. Check both with the first tagged release.
- 2026-10-03: **Phase 4: hosted multi-business server.** 4.1–4.5 and 4.7 done; 4.6 (object storage) and 4.8 (infrastructure) not started. 169 API tests pass (10 new in `test/tenancy.test.ts`).
  - **4.1 Control schema:** `apps/api/prisma/control/schema.prisma` (+ `migrations/`), with `Business`, `Account` and `Membership`.
    - `Business` holds a 6-character code without 0/O/1/I/L, `schemaName` `b_<uuid hex>`, `dbServer`, `status PROVISIONING|ACTIVE|SUSPENDED|FAILED` and `schemaVersion`.
    - `Account` is the owner's email and password; `Membership` links accounts to businesses as OWNER.
    - Its client is generated to `apps/api/node_modules/.prisma/control-client` and imported as `.prisma/control-client` (vitest needs an alias for that; see `vitest.config.mts`).
    - `pnpm --filter @pos/api prisma:generate` now generates both clients.
    - No invites: a new counter machine "joins" by signing in with the business code.
  - **4.2 Per-request business:**
    - `src/app-config.ts` starts every request with an empty `AsyncLocalStorage` store (`src/tenancy/tenant-context.ts`).
    - `AuthGuard` enters the token's business (`bid` claim, added by `signToken` from the context). `POST /auth/login` enters the business from `businessCode`.
    - `PrismaService` is now a proxy built by `createPrismaService()`. Online it hands each call to the current business's client (`TenantClients`: LRU of PrismaClients, `TENANT_CLIENT_CACHE`, `TENANT_CONNECTION_LIMIT`) and **throws when no business is chosen**. Offline it always uses the one local client. No service changed.
    - Verified that `?schema=` sets `search_path`, so raw SQL and `lockBusiness` (`current_schema()`) stay in the business.
    - `TenancyService` caches business lookups for 30 s; call `forget(id)` after changing a business.
  - **4.3 Provisioning** (`src/tenancy/provisioning.service.ts`): reserve a code and schema name, `CREATE SCHEMA`, `prisma migrate deploy` for that schema, then the same `SetupService.setup` an offline install uses (inside the business's context, so the returned session carries `bid`), mark ACTIVE, and add the owner membership. On failure the schema is dropped and the business marked FAILED.
  - **4.4 Runner:** `pnpm --filter @pos/api migrate:all` (`src/tenancy/cli.ts` → `migrate-all.ts`) migrates the control schema, then ACTIVE and SUSPENDED businesses 4 at a time. It records `schemaVersion` and stops starting new ones after a failure (exit 1). `business:create` creates a business from the terminal.
  - **4.5 Accounts and sign-in:**
    - `POST /businesses` (public, online only): owner email and password plus the setup fields. Creates the account on first use; an existing email needs its password. Returns the business, an admin session and an owner token.
    - `POST /accounts/login` and `GET /accounts/businesses` use owner tokens (`kind: 'account'`). Owner and staff tokens are not interchangeable.
    - Staff sign-in needs `businessCode` online.
    - In-memory `FailureLimiter` (`src/common/rate-limit.ts`): 10 wrong passwords per address, code and user, or per address and email, lock that pair out for 15 minutes (429). Business creation is limited to 5 per address per hour. Per process: add a shared limiter in front when running several API processes.
    - **No email verification yet**, so anyone can sign up. Decide that (open question) before opening sign-up publicly.
  - **Startup seed removed:** online, nothing is seeded (no `SEED_ADMIN_PASSWORD`). Offline, startup only runs `upgradeLegacyData()` (old plain-text passwords). `/meta` online reports the latest bundled migration as `schemaVersion`.
  - **Bug found and fixed in old migrations:** `20260310233000_item_fields` checked `pg_type` across all schemas, so the second business ever created failed (`type "TaxMode" does not exist`). `20260315093307_snapshot` checked `table_schema = 'public'`, which would silently skip changes in business schemas. Both now use `current_schema()`. **Local dev databases created with `prisma migrate dev` will report these two migrations as modified; reset them.** A test now diffs a later-created business schema against `schema.prisma`, so this can't come back unnoticed.
  - **Tests:**
    - `test/global-setup.ts` drops and recreates `pos_test` with only the control schema.
    - `helpers.startApp()` creates business `TEST` on first use (same admin and branch as the old seed), points `t.db` at its schema, passes `businessCode` on login, and adds `t.inBusiness(fn)`.
    - `local-backup.test.ts` now runs offline with `/setup`.
    - `tenancy.test.ts` covers sign-up, isolation (same usernames, cross-business ids 404, separate schemas), the schema diff, sign-in code errors, a token without a business, lockout, suspension, owner accounts, and the runner.
  - **Web:** the sign-in page asks for the business code when the server is online and remembers it per device (`pos_business_code`). Checked in the desktop app against a local online API: wrong code refused, `dev` signed in to "Dev Shop".
  - **Desktop packaging:** `stage.mjs` also generates the control client (the API loads it in both modes). The API's `files` list now includes `prisma/control`.
  - **Not done:**
    - 4.6: uploads are still on the server's disk under `/uploads/`, shared by all businesses, with random file names.
    - 4.8: PgBouncer, backups and monitoring.
    - 2.5: create/join screens in the app. The welcome screen still asks only for a server address; it should offer sign-up via `POST /businesses`.
    - Email verification for owner accounts.
- 2026-10-03: **Phase 5 (moving online) and 2.5/2.7 (create, join, move screens) done.** Owner verification is deferred (user's call). 174 API tests pass.
  - **Server address (decision):** `posServerUrl` in `apps/desktop/package.json` (empty for now; `POS_SERVER_URL` overrides it) is the hosted server built into a release. While it's empty, the create, join and move screens ask for an address. Set it once the hosted domain exists, and the fields disappear.
  - **5.3 Server import:**
    - `POST /businesses/import` (online, owner token, multipart `bundle` + `importId`) → `ImportService`.
    - The bundle is unpacked with `src/common/zip.ts`: no `..`, absolute paths or backslashes, 4 GB cap.
    - The manifest is validated with `migrationManifestSchema`. Its `schemaVersion` must equal the server's newest migration, else 409: "Update the app", or "the server hasn't been updated yet".
    - Tables must be exactly `MIGRATION_TABLES`, and every table and upload is checksummed.
    - Then: reserve the business (name from `BusinessSettings`), create and migrate the schema, `TRUNCATE` the migration-inserted rows, and load each table **in FK order with foreign keys checked** (no `session_replication_role`, which hosted Postgres often forbids). Rows go through `json_populate_recordset`, so only real columns are filled. Row counts are compared.
    - Uploads go to `uploads/imported/<businessId>/…`, and `logoUrl`/`imageUrl` are rewritten to match, so a bundle can't overwrite another business's files.
    - Finally the business is activated with the owner's membership. A failure drops the schema and the copied uploads.
    - `importId` is unique in the control schema: a retry returns the same business, another owner gets 409, and a FAILED attempt is cleared and redone.
    - `ProvisioningService` is now split into `reserve` / `createSchema` / `activate` / `discard`, shared by sign-up and import.
  - **Owner accounts:** `POST /accounts/signup` creates an account, or signs in to an existing one with its password.
  - **Offline steps** (`MigrationController`, admin):
    - `POST /migration/begin`: MIGRATING; refused while a register is open.
    - `POST /migration/abort` and `/migration/complete {businessId, businessCode, server}`: both `@AllowWhenLocked`.
    - New `LocalInstance.movedToBusinessCode` / `movedToServer` (migration `20261008100000_local_instance_moved_to`), reported by `/meta` as `movedTo`.
  - **Desktop** (`apps/desktop/src/move-online.ts`, IPC `pos:move-online` with progress events):
    - Steps: check the server and that schema versions match (if the app is older, it starts an update check) → owner sign-up/sign-in → `before-move` backup → begin → export to `userData/move-online/business.zip` → upload → complete → switch config to online and stop Postgres. The local data stays as a read-only copy.
    - Any failure before the server answers → abort, and the computer sells again.
    - **No answer to the upload** (network or timeout) → stays MIGRATING with `config.pendingImportId` kept, because the server might have the business. A retry re-exports the same paused data and gets the same business.
    - On start, an offline install whose `/meta` says moved switches to online by itself (covers a crash between "complete" and "switch").
    - `pos:create-business` sends sign-up from the main process: the page's CSP only allows the current API, which doesn't exist yet on first launch.
    - `assertAdmin` now says when the session has ended instead of "only an admin".
  - **Web:**
    - The welcome screen has three choices: one shop offline / **Create an online business** (`/create-business` = `SetupPage online`: owner email and password, business, admin, then a **business code** screen, then online) / **Join an existing business** (code + address, then the online sign-in with the code filled in).
    - `MoveOnlineDialog` (`components/MoveOnline.tsx`) shows each step and finishes with the code and "Sign in online". It's reached from the "Online only" prompts, the Transfers panel and a Settings → Business card (desktop, offline, admins).
    - `MoveOnlineNotice` on every page: paused move → Finish / Cancel (cancel warns); moved → read-only note.
    - The business code is remembered per device (`lib/business-code.ts`).
  - **Bugs found and fixed:**
    - `AppLayout` called `useIsOffline()` after an early return (since the online-only badges), causing React error #310 when going from setup into the app.
    - The welcome screen asked a non-existent API for `/meta`.
  - **Verified in the desktop app** (Xvfb, from source, local online API):
    - **Move:** the offline "Corner Store" was refused while its register was open; after closing it, the move gave code W6EUQM. Signed in online with the same admin password, and it stayed online after a restart.
    - **Create:** a new online business (code shown, then straight into it).
    - **Join:** W6EUQM from a fresh computer.
    - **Offline first launch:** still clean, with no console errors.
  - **API tests:** `test/move-online.test.ts` (export from a business → import as a new one: per-table counts, money, image link rewrite and file, staff password, retry and other-owner rules, version and damage refusals). `test/offline.test.ts` covers begin/abort/complete.
  - **Not done:**
    - owner email verification (deferred)
    - 4.6 object storage and 4.8 infrastructure
    - upload progress for big moves (`fetch` gives none; the step list shows "Uploading")
- 2026-10-03: **Restore from a backup on the welcome screen** (user's request).
  - **Flow:** a fourth choice. "Choose backup file…" opens the system file dialog in the main process (IPC `pos:restore-from-backup`; the page never gives a path), then:
    1. Start the local database and API (fresh, empty).
    2. `Backups.restoreFile()`: stop the API, run the backup tool's `restore` with the picked file, start the API. Migrations bring an older backup up to date.
    3. Set mode offline and reload at the sign-in screen.
  - **Special cases:** a backup of a business that had already moved online switches the computer to online (`switchIfMoved`). On any failure, offline services stop and the welcome screen stays: no mode was chosen.
  - **Files:** any file name works, not only the app's backup naming. A non-backup file now says "This file is not a Point of Sale backup" instead of the zip library's message.
  - **Verified in the desktop app** on a fresh computer: cancel → stays; wrong file → that message; a Corner Store backup made at an older migration, renamed `my-shop-backup.zip` → restored, migrated to the latest version, signed in with the old admin password.
- 2026-10-03: **Admin password recovery (offline) and backups off the computer** (the user's top two of the remaining crucial items). 176 API tests pass.
  - **Recovery code:**
    - The format is `XXXX-XXXX-XXXX-XXXX`, from an alphabet without 0/O/1/I/L (about 79 bits). It is stored only as a scrypt hash in `BusinessSettings.recoveryCodeHash` and `recoveryCodeCreatedAt` (migration `20261009100000_recovery_code`). Offline setup creates it and returns it once (`recoveryCode` in the `/setup` response).
    - `POST /auth/recover` (public, offline, `@AllowWhenLocked`) takes `{recoveryCode, username, newPassword}`. It resets an **admin's** password, reactivates that admin, and replaces the code. A wrong code and a non-admin username get the same message.
    - Wrong attempts: 5 per address per 15 minutes, then 429.
    - `GET`/`POST /auth/recovery-code` (offline, admins): status, and a replacement code.
    - Codes are compared without case, spaces or dashes. They travel with backups and moves, being business data.
    - **There is deliberately no code-less reset from the computer:** the counter computer is where cashiers sit.
  - **Web:**
    - After offline setup, a "Save your recovery code" screen (copy button; Continue needs the "I've saved it" tick).
    - "Forgot your password?" on the offline sign-in leads to `/recover`.
    - Settings → Business has a "Password recovery" card (status, make a new code).
    - `RecoveryCodeNotice` reminds admins of businesses with no code (set up before this).
    - Code: `components/RecoveryCode.tsx`, `screens/onboarding/RecoverPage.tsx`.
  - **Second backup folder:**
    - `config.backupCopyFolder` / `backupCopyStatus`. Settings → Backups → "Keep copies off this computer": Choose folder… (system dialog, admins), Change, Stop copying; the last copy's time, or why it failed.
    - Every backup (daily, manual, before update, restore or move) is copied there right after it's written, via a `.partial` file then rename, and that folder is pruned to the same 2–5 days with the backup tool's `prune`.
    - A missing folder (unplugged drive) is recorded, not fatal. The hourly check retries the latest backup after a failed copy, and choosing the folder copies the latest at once.
    - Code: `Backups.copyOffsite` in `apps/desktop/src/backups.ts`.
  - **Also fixed:** in the sidebar, Transfers showed both "Online only" and a lock while no register was open, which overflowed the sidebar (horizontal scrollbar, clipped icons). It now shows just the badge.
  - **Verified in the desktop app** on a fresh computer:
    - setup shows the code (Continue disabled until ticked)
    - sign out → Forgot your password? → code typed in lower case → new code shown → signed in with the new password
    - a backup copied to a "USB" folder
    - drive "unplugged" → "The last copy failed … Is the drive plugged in?"
    - plugged back → copy caught up
  - **Tests:** `test/offline.test.ts` covers setup's code format, status and replacement (admin only), the same refusal for wrong code or cashier, a loosely typed code, old code spent, and lockout.
- 2026-10-03: **Receipt layouts** (per-branch template: paper, layout, sections, preview; one renderer for POS, Sales, Returns and the printer) and a **per-computer paper override** (Settings → Printer). See README.
- 2026-10-03: **Password resets online** (item 7 of the remaining crucial list). 191 API tests pass.
  - **Staff, both modes:**
    - Migration `20261011100000_user_password_change`: `User.mustChangePassword`, `User.passwordChangedAt`.
    - Tokens now carry `iatMs`. The auth guard refuses a token signed before `passwordChangedAt` ("Your password was changed"), so every reset signs the user out everywhere. Older tokens fall back to `iat` seconds.
    - While `mustChangePassword` is set, every route except `POST /auth/change-password` and `GET /auth/me` (`@AllowBeforePasswordChange`) answers 403 with `code: PASSWORD_CHANGE_REQUIRED`. The login response carries `mustChangePassword`.
    - `POST /auth/change-password` `{currentPassword, newPassword}`: the new one must differ; 10 wrong tries per user per 15 minutes. It answers a fresh token, so this session continues.
    - `PATCH /users/:id` with `password` sets `mustChangePassword` (default: true for someone else, false for yourself; `mustChangePassword` in the body overrides). Offline recovery clears it.
  - **Online, admin forgot their password:** `POST /accounts/staff-password` (owner token) `{businessId, username, newPassword}` for a business the account owns. An admin is reactivated and keeps the password; a cashier must choose their own.
  - **Online, owner forgot their password:**
    - Control migration `20261011100000_password_reset`: `Account.passwordChangedAt`, `PasswordReset {accountId, codeHash, expiresAt, attempts, usedAt}`.
    - `POST /accounts/password-reset` `{email}` → 202 whether or not the account exists. It emails an 8-digit code (scrypt-hashed, 15 minutes, 5 wrong tries, once only; a new request replaces older codes). 5 requests per address and 3 per email an hour.
    - `POST /accounts/password-reset/confirm` `{email, code, newPassword}`: sets the password, ends owner tokens signed before it (`accountIdFrom` is now async and checks this), and marks the email verified.
    - Email: `src/mail/mailer.ts` (nodemailer). `SMTP_URL` + `MAIL_FROM`; `MAIL_TRANSPORT=log` (development) or `memory` (tests). With none, the request answers 503 "Email isn't set up on this server".
  - **Web:**
    - `/change-password`: forced, full-screen, after signing in with a password someone else set (route guards and a 403 from the API both send users there); voluntary from the user's name in the header.
    - Settings → Cashiers & Access: "Ask them to choose their own at next sign-in" (ticked by default) next to Reset Password, and a badge until they do.
    - Online "Forgot your password?" (`/recover` in online mode): owner email and password, business code, username and new password. Cashiers are told to ask an admin.
    - `/owner-password`: email → code + new password. In the desktop app it goes through `pos:owner-password-reset` in the main process (the page may not be allowed to reach the server: first launch, offline). Linked from the create-business form, the move-online dialog and the online recover page.
  - **Verified in the desktop app** against a local hosted server with `MAIL_TRANSPORT=log`:
    - create business → admin resets a cashier → cashier signs in → forced change screen (other pages redirect back) → chooses one → open register
    - admin "forgot" → the owner resets it → admin signs in
    - owner "forgot" → code read from the logged email → new owner password (old refused, new accepted)
    - own password change from the header keeps you signed in
    - The offline recovery-code flow still passes its earlier end-to-end run.
  - **Not done:** owner email verification at sign-up (still deferred); an owner-side screen listing all staff.
- 2026-10-03: **Session hardening** (item 8 of the remaining crucial list): sign-ins are httpOnly cookies, not tokens in localStorage. 197 API tests pass.
  - **API:**
    - `src/auth/session-cookie.ts`. A request with `x-pos-session: cookie` (`SESSION_HEADER`) has its `pos_session` cookie read as the token; without the header the cookie is ignored. This is the CSRF defence: a cross-site form or link can't add a header, and a cross-origin script needs CORS to allow it.
    - A global interceptor moves any staff token in such a request's answer (`token`, or `session.token` when creating a business) into the cookie and blanks it in the body: login, setup, registers open/close, change-password. Owner tokens are left alone.
    - Cookie: `HttpOnly; Path=/; SameSite=Lax; Max-Age=<token TTL>`, `Secure` behind HTTPS. Overrides: `SESSION_COOKIE_SECURE`, `SESSION_COOKIE_SAMESITE`.
    - `POST /auth/logout` (public) clears it.
    - Bearer tokens work as before (API clients, tests, owner tokens).
    - CORS sends `Access-Control-Allow-Credentials` only for origins in `CORS_ORIGINS` (and offline's dev origins). With no list online, no other site can use the cookie.
  - **Web:**
    - `Session` has no token; old stored sessions lose theirs, which means one sign-in after updating.
    - The ts-rest client sends the header with `credentials: 'include'`.
    - `apiFetch()` does the same for uploads (closes 2.2).
    - `signOut()` calls `/auth/logout`.
    - The desktop bridge calls no longer take a token.
  - **Desktop:**
    - The page's API base is `app://pos/api` (`PAGE_API_BASE`). `protocol.ts` forwards it with `net.fetch` to the local API or the online server, dropping Origin, Cookie and Referer and stripping Set-Cookie from answers. Electron keeps the cookie in the default session's store, where the page can't reach it.
    - CSP is now `connect-src 'self'` and `img-src 'self' data: blob:`.
    - The main process's admin checks (backups, printer, move online) ask `/auth/me` with that cookie (`sessionFetch`); move online uses it for the local API.
    - Creating a business sends through the same store, so the new admin's cookie is set for the server.
    - Printing rewrites `app://pos/api/` image links to the real API for the print window.
    - Switching to online removes the local API's cookie.
  - **Also fixed:**
    - Item images were saved with the API's full address. Offline, that included a port that changes every launch, so images broke after a restart, and moving online didn't rewrite them. They are now saved as `/uploads/…`; older full local addresses are mapped when shown (`uploadSrc`). The item `imageUrl` response schema no longer demands an absolute URL.
    - API tests used the development `uploads/` folder. Every move-online test run copied all uploads into `uploads/imported/<id>/` and the next run exported them again, doubling each time (1.4 GB here) until the test timed out. Tests now get `$TMPDIR/pos-test-uploads`, emptied by the global setup.
  - **Verified:**
    - **Desktop offline:**
      - setup leaves no token stored, an empty `document.cookie` and an httpOnly cookie in the app's store
      - sales, returns, printer settings and printing
      - logo upload through the app, printed with the logo
      - backup; restart and still signed in; sign-out deletes the cookie
      - move online to a local server → online sign-in sets that server's cookie; the logo moved with the business
    - **Desktop online:** create business (main process) and all the password flows.
    - **Browser** (web on localhost:3000, API on localhost:3998 with `CORS_ORIGINS`):
      - httpOnly SameSite=Lax cookie; nothing in localStorage
      - signed in after a full page load
      - a request without the header gets 401
      - sign-out removes the cookie
- 2026-10-03: **Owner email verification and the other email features** that waited on email (the user's call, now that the server can send email). 204 API and 126 contracts tests pass.
  - **Owner verification:**
    - Control migration `20261012100000_email_verification`: `EmailVerification {email, codeHash, expiresAt, attempts, usedAt}`, keyed by email because the account may not exist yet.
    - `findOrCreate` (used by `POST /businesses` and `/accounts/signup`, which move online uses) checks the password first. Then, for a new address or an unverified account, without `emailCode` it emails an 8-digit code and answers 400 `code: EMAIL_VERIFICATION_REQUIRED`; with the code it sets `emailVerifiedAt` (and only then creates a new account).
    - Codes: 15 minutes, 5 wrong tries, once only, scrypt-hashed.
    - Code emails: 5 per address and 3 per email an hour. A "code sent" answer isn't counted as a failed sign-in.
    - `OWNER_EMAIL_VERIFICATION=off` turns it off; the API tests run with it off except `test/owner-email.test.ts`.
  - **Owner notices** (`Mailer.sendNotice`: only when email is set up, failures logged): the business code after creating or moving a business, and "your owner password was changed" after a reset.
  - **SMTP:** nodemailer gets 10 s connection and greeting and 20 s socket timeouts unless `SMTP_URL` sets its own.
  - **Emailed receipts:**
    - `POST /sales/:id/email-receipt` `{email}`: online only, open-register session, this branch's sales; 30 an hour per user; 503 without email.
    - `ReceiptEmailService` builds the receipt from the invoice (`invoiceReceiptItems`, `saleReceiptDocument`, the branch's template, the business time zone) and sends text plus HTML (monospace; large lines at double size).
    - Staff can't put their own text into the email.
  - **Shared receipt code:** the GST helpers (`gstDocumentTitle`, `gstMetadata`, `gstTaxAmounts`, `gstFooterLines`, `invoiceGstOf`), `saleReceiptDocument`, `returnReceiptDocument`, `rateFromAmounts` and `settingLines` moved from the web app to `packages/contracts/src/receiptDocuments.ts`, plus `invoiceReceiptItems` and time-zone-aware `formatReceiptDate`/`formatReceiptTime`. The web app re-exports them.
  - **Desktop and web:**
    - Creating a business and moving online return `{emailCodeRequired, message}` instead of failing. The form shows "Code from the email" (`components/EmailCodeField.tsx`) and "Send a new code"; changing the email clears it. Moving online asks before anything changes on the computer.
    - `components/EmailReceipt.tsx` on the POS after a sale and on Sales for any sale. Offline it shows "Online only", disabled.
    - The fake "Receipt sent to …" message on Sales is gone. The POS keeps "Download the receipt (to share on WhatsApp)".
  - **Verified in the desktop app** against a local server with `MAIL_TRANSPORT=log`:
    - create business → code asked → code from the log → created; the business-code email was sent
    - a sale emailed from Sales; the email matches the printed layout, with the time in the business time zone
    - an offline business shows "Online only" on the email field
    - move online → code asked (still offline) → code → moved; the "has moved online" email was sent
  - **Not done:** invites (joining stays by business code); a customer email field on customers (the address is typed when sending).
- 2026-10-03: **Phase 7, the fallback counter, done.** 211 API and 126 contracts tests pass.
  - **Server** (`apps/api/src/fallback/`):
    - Migration `20261013100000_fallback_counter`: `Counter.fallbackDeviceId` (unique), `fallbackKeyHash`, `fallbackReceiptSeq`.
    - `POST /counters/:id/fallback` (admin, online; `{deviceId}`) clears any other fallback counter of the branch and answers the key `fb1.<business>.<counter>.<secret>`, whose secret is kept only as a scrypt hash. It refuses while the counter's register is open elsewhere. `DELETE` undoes it.
    - Opening a register checks the desktop app's `x-pos-device` header against `fallbackDeviceId`. That header is a guard against mistakes, not a secret.
    - `GET /fallback/snapshot` (key) uses `createBackup` with `only` (tables, each with an optional row condition) and `uploadFiles` (logos). Tables:
      - settings
      - branches, this branch's counters
      - the counter's INVOICE sequence
      - staff with access to the branch (and their access rows)
      - customers (the branch's, or all when shared)
      - items, sale units, the branch's prices and stock
      - the counter's open register
      - No sales and no wallets.
    - `POST /fallback/sync` (key; 25 MB body limit on that route only, wrapped so Nest keeps its own `jsonParser`):
      - checks every row belongs to the counter (its series, branch and registers)
      - inserts with `json_populate_recordset … ON CONFLICT (id) DO NOTHING`, so it is idempotent
      - stock ledger rows insert and update `ItemStock` in one statement, only for newly added movements
      - raises `DocumentSequence` and `fallbackReceiptSeq` with `GREATEST`
      - a register opened offline closes an older one still open online on that counter
      - the same schema version is required on both sides
      - a conflict (a number already used, a deleted item) answers 409 and the sales stay on the computer
  - **Local fallback mode** (`POS_FALLBACK=1`, `POS_FALLBACK_COUNTER_ID`, `POS_FALLBACK_SECRET`):
    - GET is allowed, plus sign-in and sign-out, register open and close, checkout and the number catch-up. Everything else answers 403 `FALLBACK_UNAVAILABLE`.
    - Checkout takes the exact amount in cash or card: no wallet or credit, and no change to a wallet.
    - Receipts are `RCPT-<branch>-F<counter>-NNNNNN` from `Counter.fallbackReceiptSeq`.
    - `GET /fallback/outbox` and `POST /fallback/numbers` need the secret.
  - **Desktop** (`apps/desktop/src/fallback.ts`, `main.ts`):
    - `config.deviceId` and `config.fallback`.
    - The copy runs in its own PostgreSQL (`userData/fallback/pgdata`, `fallback-postgres.log`) under a second `LocalApi`.
    - It refreshes every 10 minutes, and when a register opens or closes through the app, never while offline sales are waiting. Refresh means: download, then the backup tool's `restore`.
    - The proxy notes every invoice number issued through it, since this computer alone issues the fallback counter's series. On switching to offline, `/fallback/numbers` moves the copy past them.
      - **Found by the end-to-end run:** without this, an online sale made after the last refresh and the first offline sale got the same number. The sync refused the duplicate, which is the safety net.
    - The proxy reports unreachable (network error, 502, 504) and sends `x-pos-device`. While the offline sales are sent, page requests get 503.
    - Bridge `fallback.status/setup/remove/start/finish/onStatus`, and the event `pos:fallback-status`. The server is checked every 30 seconds while selling offline.
  - **Web:**
    - `components/FallbackBanner.tsx` (on every screen, including sign-in): can't reach the server, working offline, the server is back, sending.
    - Settings → Counters: "Use as fallback here" and "Stop fallback", with a line about the copy.
    - Open Register shows a fallback counter bound to another computer as "Its own computer".
  - **Tests:**
    - `test/fallback.test.ts` builds the API into `node_modules/.cache` and runs the local copy as a child process in fallback mode. It covers binding and the device check, the copy's tables, an offline sale continuing the series (after a catch-up) with its own receipt series, the limits offline, sync twice (idempotent) with stock, numbering after the sync, rows of another counter refused, and the key dropped.
    - **End-to-end in the desktop app:** create a business → item → this computer as fallback (copy made) → register opened (copy refreshed) → online sales 00001 and 00002 → server stopped → "Can't reach the server" → "Keep selling on this computer" → sign in → offline sale 00003 with RCPT-MAI-F1-000001; a new customer is refused → server restarted → "Send offline sales and go back online" → the server has 00001 to 00003, the next sale is 00004, stock 46 of 50.
  - **Not done** (also in `remaining-work-plan.md`):
    - item images offline (only the logos are in the copy)
    - history and reports offline show only offline sales
    - returns, credit, new customers and settings changes offline
    - prices or passwords changed online after the last refresh
    - the cash figures of a register closed by the sync are left empty
    - a sync conflict needs support
    - packaged builds on Windows and macOS
