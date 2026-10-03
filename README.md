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
For a quick local start set `POS_MODE=offline` too.

3. Generate the Prisma clients (business data and the hosted server's control schema):
```bash
pnpm --filter @pos/api prisma:generate
```
Then prepare the database for the mode you run (see **Businesses and the first admin**).

4. Build the shared packages, then run both apps:
```bash
pnpm --filter @pos/types --filter @pos/contracts build
pnpm dev
```

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:3001`

## Businesses and the first admin
The API runs in one of two modes (`POS_MODE` in `apps/api/.env`):

- **`offline`**: one business on one computer, as the desktop app runs it. On first start the
  web app shows a setup screen that creates the business and its admin. This is also the simplest
  way to run the app locally.
- **`online`** (default): the hosted server, many businesses with one PostgreSQL schema each,
  listed in a `control` schema. Prepare the database and create a business:
  ```bash
  pnpm --filter @pos/api build
  pnpm --filter @pos/api migrate:all       # control schema + every business; run at every deploy
  pnpm --filter @pos/api business:create -- --name "My Shop" --admin admin --password <password> --code DEV
  ```
  Staff sign in with the business code, their username and password. Owners can also create
  businesses with `POST /businesses` (email and password for their owner account).

There are no default passwords; create cashiers from Settings → Cashiers & Access.

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
Run the API with `POS_MODE=offline` against the `pos_pr_auth_test` database
(`DATABASE_URL=…/pos_pr_auth_test?schema=public`, then `npx prisma migrate deploy` in
`apps/api`), finish the setup screen with an admin called `admin`, then run
`pnpm --filter @pos/api seed:demo` to populate the
isolated `pos_pr_auth_test` database with three branches, ten everyday products,
four GST scenario products, placeholder images, and 12 months of regular sales.
It also adds an earlier composition quarter and GST examples in the last completed
month: intra and inter-state B2C, B2CL, nil/exempt/non-GST supplies, returns and
credit notes, and a cancelled invoice. The GSTINs are synthetic demo identifiers;
the export is for software testing only. The seed refuses other database names and
can be rerun without duplicating sales. Sign in as `admin` to browse it (the seed writes
its three branches directly, past the one-branch limit of offline mode).

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
Release order: deploy the server first, then publish the desktop release. When a release
changes the API or database in a way older apps can't handle, set `MIN_CLIENT_VERSION` on the
server: older desktop apps are then turned away (426), download the update and ask to restart.
Otherwise updates install when the app closes, and a note offers to restart sooner.
In offline mode the app backs up the business every day and before each update, keeping
the last 2–5 days (Settings → Backups, where admins can also restore). Backups can also be copied
to a second folder (a USB drive or a synced cloud folder). On a new computer, the welcome
screen's "Restore from a backup" brings a business back from a backup file. A forgotten admin
password is reset with the recovery code shown at setup ("Forgot your password?").
Each branch picks its receipt layout under Settings → Receipts, with a preview: the paper (58 or
80 mm, normal, small or large text), a layout (classic, detailed GST, compact columns or minimal)
and which parts print (logo, HSN codes, GST summary, savings, bill-number barcode and more). What a
GST bill needs always prints. The layout is `renderReceipt` in `packages/contracts`, so the POS,
Sales and Returns screens and the printer all print the same thing.
In either mode, each computer can have a receipt printer (Settings → Printer): receipts then
print in one click with no dialog, sized for the branch's paper, and optionally as soon as a sale is paid. A cash drawer plugged into that printer opens (ESC/POS
drawer kick) when cash is taken or refunded. Without a printer, Print opens the system dialog
as in a browser. Code: `apps/desktop/src/printing.ts`, `apps/web/src/lib/printing.ts`. The app's
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
