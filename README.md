# Point Of Sale (POS)

Monorepo POS system with multi-branch inventory + sales workflow.

## Stack
- Backend: NestJS + Prisma + PostgreSQL
- API contracts: ts-rest + zod
- Frontend: React + TanStack Router + TanStack Query + ts-rest client
- Monorepo: Turborepo + pnpm workspaces

## Apps and Packages
- `apps/api`: POS backend API
- `apps/web`: POS frontend
- `apps/desktop`: desktop app (Electron) that runs the web app, offline or online
- `packages/contracts`: Shared ts-rest API contracts
- `packages/types`: Shared domain enums/types

## Quick Start
Needs Node 22.12 or later and PostgreSQL.

1. Install dependencies:
```bash
pnpm install
```

2. Configure environment:
```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```
Set `AUTH_SECRET` in `apps/api/.env` (at least 32 characters; the file shows how to generate one). The API won't start without it.

3. Generate Prisma client and migrate database:
```bash
pnpm --filter @pos/api prisma:generate
pnpm --filter @pos/api prisma:migrate
```

4. Build the shared packages, then run both apps:
```bash
pnpm --filter @pos/types --filter @pos/contracts build
pnpm dev
```

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:3001`

## First Admin
On first startup with an empty database the API creates one `admin` user (branch code `MAI`).
Its password is `SEED_ADMIN_PASSWORD` from `apps/api/.env`, or, if that is empty, a random
password printed once in the API log. There are no default passwords; create cashiers from
Settings → Cashiers & Access.

## Tests
```bash
pnpm test
```
- `packages/contracts`: unit tests for the shared pricing maths (tax, discounts, order-discount
  split, returns) and the receipt CSS sanitizer.
- `apps/api`: tests that start the real API against a separate database, `pos_test`, which is
  dropped and re-migrated at the start of every run (the setup refuses any database whose name
  doesn't contain `test`). They need PostgreSQL at `postgres:postgres@localhost:5432`, or set
  `TEST_DATABASE_URL`. They cover sign-in and tokens, branch isolation, validation, pricing and
  the cashier discount limit, settling and wallets, returns, stock under concurrency, checkout
  idempotency, reports, register balancing, customer sharing and time zones.

## Local demo data
After starting the API once, run `pnpm --filter @pos/api seed:demo` to populate the
isolated `pos_pr_auth_test` database with three branches, ten everyday products,
four GST scenario products, placeholder images, and 12 months of regular sales.
It also adds an earlier composition quarter and GST examples in the last completed
month: intra and inter-state B2C, B2CL, nil/exempt/non-GST supplies, returns and
credit notes, and a cancelled invoice. The GSTINs are synthetic demo identifiers;
the export is for software testing only. The seed refuses other database names and
can be rerun without duplicating sales. Sign in with the `admin` account configured
in `apps/api/.env` to browse it.

## Desktop app
`apps/desktop` packages the POS as a desktop app (Electron). On first launch the owner picks a
business type:
- **One shop, one billing counter:** works without internet. The app runs its own PostgreSQL and
  the API on this computer, and a setup screen creates the business and its admin.
- **More than one counter or branch:** connects to a hosted server (online mode).

Run it from source (Linux needs a desktop session; Postgres won't run as root):
```bash
pnpm build
pnpm --filter @pos/desktop start
```
Build an installer for the current OS (output in `apps/desktop/release/`):
```bash
pnpm --filter @pos/desktop dist
```
Releases: push a `v<version>` tag after setting the same version in `package.json`,
`apps/desktop/package.json` and `packages/contracts/src/version.ts`. The workflow publishes the
installers to GitHub Releases, and installed apps check there for updates every day.
In offline mode the app backs up the business every day and before each update, keeping
the last 2–5 days (Settings → Backups, where admins can also restore). The app's
data and logs are in the OS's app-data folder under "Point of Sale". See
`desktop-offline-online-plan.md` for the design and what's left.

## Auth Model
Protected endpoints use:
- `Authorization: Bearer <token>`

The token is returned by `/auth/login` and is stored by the frontend session helper. It is signed
with `AUTH_SECRET`, expires after `AUTH_TOKEN_TTL_HOURS` (default 12), and every request is
re-checked against the database (user active, same role, branch access, register still open).

## Implemented Modules
- Customers + walk-in customer + wallet topup/balance
- Item master (create/list/update)
- Stock opening + adjustment + on-hand + ledger
- Sales invoice creation with tax/discount and stock deduction
- Split settlement (cash/card/wallet) with wallet debit and receipt creation
- Returns against original invoice with stock reversal and wallet refund support
- Receipt fetch by id or invoice
- Counters per branch (set up by admins in Settings → Branches): each counter runs its own register and cash drawer, so several cashiers can sell in a branch at once
- GST invoice and credit note numbers per counter: `{branch code}/{counter}/{YY}/{count}`, e.g. `MAI/1/26/00001` and credit notes `MAIR/1/26/00001` (branch codes are exactly 3 letters or digits; the count restarts every April)

## UI Flow
- If no active session: login screen is shown.
- If active session exists: app opens directly to `/pos`.
- POS is the primary screen with product grid (left) and order summary/customer/payment (right).
- Other modules are in the left sidebar (collapsible; a drawer on small screens).
