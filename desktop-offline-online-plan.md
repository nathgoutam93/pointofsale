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

### [ ] 2.1 Runtime API base URL
- **Where:** `apps/web/src/lib/api.ts`. `API_BASE_URL` is also used directly in `BranchSettingsPage.tsx`, `ItemsPage.tsx`, `SalesPage.tsx`, `ReturnsPage.tsx` and `screens/pos/useStoreSettings.ts`.
- **What:**
  - Replace the build-time constant with `getApiBaseUrl()`. It reads `window.posDesktop?.config.apiBaseUrl`, then falls back to `import.meta.env.VITE_API_BASE_URL`, then to `http://localhost:3001`.
  - Create the ts-rest client lazily, or rebuild it when the mode changes.
  - Add `assetUrl(path)` for logo and image URLs, replacing the four copies of the `replace(/\/$/, '')` logic.
- **Done when:** nothing imports `API_BASE_URL`, and switching the config then reloading points every call, upload and image at the new server.

### [ ] 2.2 Shared upload helper
- **Where:** the raw `fetch` uploads in `BranchSettingsPage.tsx` (business logo, branch logo) and `ItemsPage.tsx` (item image).
- **What:** One `uploadFile(path, file)` in `lib/api.ts` that uses `getApiBaseUrl()`, adds auth headers and handles 401 like the ts-rest client. This also closes a follow-up listed in `fix-plan.md` item 1.
- **Done when:** all three uploads use it.

### [ ] 2.3 Welcome and business-type screen
- **Where:** new `apps/web/src/screens/onboarding/`. Route guard in `router.tsx`: if `posDesktop.config.mode` is unset, go to `/welcome`.
- **What:** Two choices:
  - **"One shop, one billing counter"**: works without internet. Goes to 2.4.
  - **"More than one counter or branch"**: shows "This needs an internet connection and an online account." Then offers **Create a new business** or **Join an existing business** (2.5).
  - Also include a small "Already moved online? Sign in" link.
- **Done when:** the choice is saved through `posDesktop.setMode(...)` and the app restarts into that mode.

### [ ] 2.4 Offline setup form
- **Depends on:** 1.3, 3.4.
- **What:** Business name, GSTIN (optional), taxpayer type, state, timezone, admin username and password (entered twice). Calls `POST /setup` on the local API, then signs in.
- **Done when:** a fresh install reaches the POS screen with no terminal output needed.

### [ ] 2.5 Online create or join
- **Depends on:** 4.5.
- **What:**
  - **Create:** owner account (email, password, email code), business details, then the business is created on the server, then sign in.
  - **Join:** the business code or invite code from an admin, plus username and password, then sign in.
  - Save `{ mode: 'online', apiBaseUrl, businessId, businessCode }` in the config.
- **Done when:** a second machine can join a business made on the first.

### [ ] 2.6 Hide what offline mode can't do
- **Depends on:** 1.2.
- **Where:** `AppLayout.tsx` nav (`/transfers` is at line ~50), branch and counter settings, branch price screens.
- **What:** When `mode === 'offline'`:
  - hide Transfers, "Add branch" and "Add counter"
  - show a short "Need more counters? Move online" hint linking to 2.7
- **Done when:** none of the actions refused by 1.4 can be reached from the UI.

### [ ] 2.7 "Move to online" button
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

### [ ] 2.8 Update notices
- **Depends on:** 3.5.
- **What:** A banner for "Update ready — restart to install". A blocking screen for "This version is no longer supported — updating…" when below `minClientVersion`.

---

## Phase 3: Desktop app (Electron)

Branch: `feat/desktop-shell`. Can run in parallel with Phase 4.

### [ ] 3.1 Scaffold `apps/desktop`
- **What:**
  - Electron main, preload and `electron-builder` config. The build depends on `@pos/web` and `@pos/api` building first (add it to `turbo.json`).
  - Register a privileged `app://` scheme that serves `apps/web/dist` with SPA fallback. TanStack Router uses browser history, so `file://` won't work.
  - Set a strict CSP: `connect-src` allows only the local API and the hosted API domain.
- **Done when:** `pnpm --filter @pos/desktop dev` opens the web app in a window.

### [ ] 3.2 Embedded PostgreSQL
- **What:**
  - Use `embedded-postgres`. Data lives in `userData/pgdata`, Postgres listens on 127.0.0.1 on a free port, and the database password is random, generated on first run and stored in `userData/config.json`.
  - Run `initdb` on first run, start on launch and do a clean stop on quit.
  - On a crash, restart once, then show an error with "open logs".
- **Done when:** the database survives an app restart and a forced kill.

### [ ] 3.3 Local API process
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

### [ ] 3.4 Config store and preload bridge
- **What:**
  - `userData/config.json` holds `{ mode, apiBaseUrl, businessId, businessCode, onboardedAt }`.
  - The preload exposes only `window.posDesktop`: `config`, `setMode`, `restart`, `getVersion`, `exportForMigration`, `onUpdateStatus`, `installUpdate`.
  - Turn on `contextIsolation` and turn off `nodeIntegration`.
- **Done when:** the web app reads the mode and base URL from `posDesktop.config` (2.1).

### [ ] 3.5 Daily update check
- **What:**
  - `electron-updater` with GitHub Releases. Check at launch and every 24 h while the app is running, and download in the background.
  - Before installing, the app checks the server's `GET /meta` `minClientVersion` (online mode, or offline when the internet is available). Below the minimum: block and install now. Otherwise: install on the next restart, never mid-sale.
  - After an update, 3.3 runs migrations on the next start.
- **Done when:** a test release moves an installed app forward and a pending migration is applied.

### [ ] 3.6 Local backups (offline)
- **What:**
  - Run a daily `pg_dump` of the local database plus the uploads folder into `userData/backups`, keeping the last 14. Always take one before migrations and before the move online.
  - Settings: "Back up now", "Open backups folder" and "Restore from backup" (with confirmation).
- **Done when:** a restore brings back a deleted sale.

### [ ] 3.7 Release pipeline
- **What:**
  - A GitHub Actions matrix (Windows, macOS, Linux) builds installers on a version tag and publishes them to GitHub Releases.
  - Code signing: a Windows certificate, and an Apple Developer ID plus notarization. Without signing, auto-update fails on macOS and SmartScreen warns on Windows.
- **Done when:** tagging `vX.Y.Z` produces signed installers and `latest*.yml` update feeds.

---

## Phase 4: Hosted multi-business server

Branch: `feat/multi-tenant`. Can run in parallel with Phase 3.

### [ ] 4.1 Control schema
- **What:** A separate Prisma schema `apps/api/prisma/control.prisma` with its own generated client and its own migrations, living in the `control` Postgres schema:
  - `Business { id, code (short, for joining), name, schemaName, dbServer, status (PROVISIONING|ACTIVE|SUSPENDED), schemaVersion, createdAt }`
  - `Account { id, email, passwordHash, emailVerifiedAt }`
  - `Membership { accountId, businessId, role }`
  - `Invite { code, businessId, expiresAt }`
  - `ImportJob { id, businessId, status, error, counts }`
- **Note:** store `dbServer` now, even with a single server, so businesses can move to a second Postgres server later.

### [ ] 4.2 Per-request database client
- **Where:** `apps/api/src/prisma.service.ts`, `auth.guard.ts`, `auth/token.ts`.
- **What:**
  - Keep every service unchanged. `PrismaService` becomes a proxy that hands each call to the client stored in an `AsyncLocalStorage` request context.
  - The guard reads the token's `bid` (business ID) claim, looks up the business, and runs the request inside that context.
  - Clients are cached (LRU with an idle timeout), each with `connection_limit=2` and `pgbouncer=true`.
  - With no business in context, any database call throws. It never falls back to `public`.
  - Offline mode uses one fixed client, unchanged.
- **Done when:** the existing API tests pass in online mode against a provisioned test business.

### [ ] 4.3 Business provisioning
- **What:**
  1. `CREATE SCHEMA tenant_<id>`.
  2. Run `prisma migrate deploy` with `DATABASE_URL=...?schema=tenant_<id>`.
  3. Create the business settings, the first branch, counter 1 and the admin user.
  4. Mark the business `ACTIVE`.

  If any step fails, drop the schema and mark the business failed.

### [ ] 4.4 Migration runner for all businesses
- **What:**
  - A deploy script that applies migrations to the control schema, then to every business schema with limited concurrency. It records `schemaVersion` per business and stops on the first error.
  - Write migrations as expand/contract (add the new thing, release, then remove the old) so the running API works with both the old and new schema during a rollout.
- **Done when:** deploying a new migration to 50 test businesses finishes, and a forced failure stops and reports which business failed.

### [ ] 4.5 Accounts, sign-in and joining
- **What:**
  - Owner signup with an email code, `POST /businesses` (create), and invite and join endpoints.
  - Cashier and admin sign-in becomes `{ businessCode, username, password }`. Extend the `auth.login` contract with an optional `businessCode`, required in online mode. Tokens carry `bid`.
  - Rate-limit sign-in. This is also a `fix-plan.md` follow-up.
- **Done when:** two businesses can each have a user called `admin` without clashing.

### [ ] 4.6 Uploads in object storage
- **What:** Online mode stores uploads in S3-compatible storage under `<businessId>/...` and serves them through signed or proxied URLs. Offline mode keeps the disk folder.

### [ ] 4.7 Business isolation tests
- **What:** Two businesses with the same usernames, branch codes and item names. Every endpoint must return only the caller's data, and every `:id` route must return 404 for the other business's IDs.

### [ ] 4.8 Infrastructure
- **What:** Postgres with PgBouncer in transaction mode, automated backups including per-business `pg_dump -n tenant_<id>`, `MIN_CLIENT_VERSION` in the env, and monitoring of connection counts.

---

## Phase 5: Moving a business online

Branch: `feat/go-online`. Depends on 1.6, 1.7, 4.1–4.5.

### [ ] 5.1 Bundle format and shared table list
- **What:** `packages/contracts/src/migration.ts` holds:
  - the bundle format version
  - the ordered table list
  - the manifest zod schema

  Both export (1.6) and import (5.3) use it.

### [ ] 5.2 Version gate
- **What:** The move is allowed only when bundle `schemaVersion` equals the server's current schema version. Otherwise the server returns 409 `update_required`, the client updates (3.5), restarts and tries again. The local database is never migrated by the server.

### [ ] 5.3 Server import
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

### [ ] 5.4 Client switch-over and failure handling
- **What:**
  1. Back up locally (3.6).
  2. Lock local writes: set `LocalInstance` to a `MIGRATING` state that blocks writes like 1.7.
  3. Export, upload and poll `ImportJob`.
  4. On success, set `ARCHIVED` with the new business ID, switch the config to online and restart to the sign-in screen with the business code filled in.
  5. On failure or cancel, set the state back to `ACTIVE` and keep working offline.
- **Done when:** killing the network mid-upload leaves a working offline app, and a retry succeeds.

### [ ] 5.5 End-to-end test
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

### [ ] 6.2 Release order
- **What:** Write it down in `README.md`:
  1. Deploy the server, including business migrations (4.4).
  2. Publish the desktop release with the same version.
  3. When a release has a breaking API or schema change, raise `MIN_CLIENT_VERSION` on the server. The hosted API must accept the previous client version until then.

### [ ] 6.3 Client behaviour on version mismatch
- **What:**
  - **Online:** every response carries an `X-POS-Min-Client` header. If the app is below it, show the blocking update screen (2.8).
  - **Offline:** the daily check (3.5) keeps the app current when the internet is available. Offline-only shops that never connect keep working on their version. The move online (5.2) forces an update first.

---

## Open questions (decide before the item that needs it)

- Hosting provider and domain for the hosted API (needed for 4.8 and 3.1's CSP).
- Owner sign-in: email and password with an email code, or phone with OTP? (4.5)
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
