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
On first startup with an empty database the API creates one `admin` user (branch code `MAIN`).
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

## UI Flow
- If no active session: login screen is shown.
- If active session exists: app opens directly to `/pos`.
- POS is the primary screen with product grid (left) and order summary/customer/payment (right).
- Other modules are available via hamburger menu.
