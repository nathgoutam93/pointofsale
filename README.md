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
1. Install dependencies:
```bash
pnpm install
```

2. Configure environment:
```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

3. Generate Prisma client and migrate database:
```bash
pnpm --filter @pos/api prisma:generate
pnpm --filter @pos/api prisma:migrate
```

4. Run both apps:
```bash
pnpm dev
```

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:3001`

## Default Seed Users
- `admin / password`
- `cashier / password`

These are seeded on API startup (branch code: `MAIN`).

## Auth Model
Protected endpoints use:
- `Authorization: Bearer <token>`

The token is returned by `/auth/login` and is stored by the frontend session helper.

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
