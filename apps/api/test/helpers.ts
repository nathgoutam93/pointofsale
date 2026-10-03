import { randomBytes, randomUUID } from 'crypto';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-config';
import { isOffline } from '../src/common/mode';
import type { SetupInput } from '../src/setup/setup.service';
import { schemaUrl } from '../src/tenancy/database-urls';
import { ProvisioningService } from '../src/tenancy/provisioning.service';
import { TenancyService } from '../src/tenancy/tenancy.service';
import type { ActiveBusiness } from '../src/tenancy/tenant-context';

export const ADMIN = { username: 'admin', password: 'admin-test-password' };

export type ApiResponse<T = any> = { status: number; body: T };

/** The business tests run in on the hosted (online) server: like the old single-business seed. */
export const TEST_BUSINESS_CODE = 'TEST';
const TEST_BUSINESS: SetupInput = {
  businessName: 'Main Branch',
  branchCode: 'MAI',
  timezone: 'Asia/Kolkata',
  taxpayerType: 'REGULAR',
  adminUsername: ADMIN.username,
  adminPassword: ADMIN.password
};

/** The test business, created by the first test file that needs it (files run one at a time). */
async function testBusiness(app: NestExpressApplication): Promise<ActiveBusiness> {
  const control = app.get(TenancyService).control;
  const find = () =>
    control.business.findUnique({
      where: { code: TEST_BUSINESS_CODE },
      select: { id: true, code: true, name: true, schemaName: true, dbServer: true }
    });
  const existing = await find();
  if (existing) return existing;
  await app.get(ProvisioningService).createBusiness(TEST_BUSINESS, { code: TEST_BUSINESS_CODE });
  return (await find())!;
}

/** The real app (guard, validation, service) on a random port, plus a direct DB client. */
export async function startApp() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  const baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  // Online: the test business's own schema. Offline: the one local database.
  const business = isOffline() ? null : await testBusiness(app);
  const businessCode = business?.code;
  const db = new PrismaClient(business ? { datasourceUrl: schemaUrl(business.schemaName) } : undefined);
  /** Runs `work` as a request for the test business would (services, raw queries). */
  const inBusiness = <T>(work: () => Promise<T>) => (business ? app.get(TenancyService).run(business, work) : work());
  // Signing in picks up a register the user still has open, so start each file with none
  // left over from earlier files.
  await db.registerSession.updateMany({ where: { closedAt: null }, data: { closedAt: new Date(), closingBalance: 0 } });

  async function call<T = any>(method: string, path: string, token?: string | null, body?: unknown): Promise<ApiResponse<T>> {
    const res = await fetch(baseUrl + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let parsed: any = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // not JSON
    }
    return { status: res.status, body: parsed };
  }

  /** Like call, but fails the test unless the request succeeded. */
  async function ok<T = any>(method: string, path: string, token?: string | null, body?: unknown): Promise<T> {
    const res = await call<T>(method, path, token, body);
    if (res.status >= 300) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  }

  async function login(username = ADMIN.username, password = ADMIN.password) {
    return (await ok<{ token: string }>('POST', '/auth/login', null, { businessCode, username, password })).token;
  }

  /** A 3-character branch code no branch has yet. */
  async function freeBranchCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    for (;;) {
      const code = Array.from(randomBytes(3), (byte) => chars[byte % chars.length]).join('');
      if (!(await db.branch.findUnique({ where: { code }, select: { id: true } }))) return code;
    }
  }

  /** A new branch with a free code. */
  async function newBranch(adminToken: string, label = 'Test') {
    const code = await freeBranchCode();
    return ok<{ id: string; code: string }>('POST', '/branches', adminToken, { name: `${label} ${code}`, code });
  }

  /** A fresh branch with an open register (so each test file has its own data). */
  async function branchWithRegister(adminToken: string, openingBalance = 0) {
    const branch = await newBranch(adminToken);
    const opened = await ok<{ token: string; register: { id: string } }>('POST', '/registers/open', adminToken, {
      branchId: branch.id,
      openingBalance
    });
    const walkIn = await ok<{ id: string }>('GET', `/customers/walk-in/${branch.id}`, opened.token);
    return { branch, token: opened.token, registerId: opened.register.id, walkIn };
  }

  /** A cashier signed in with a register open at `branchId`, with the permissions given. */
  async function cashierWithRegister(adminToken: string, branchId: string, permissions: string[] = []) {
    const username = `cashier-${randomUUID().slice(0, 8)}`;
    const user = await ok<{ id: string }>('POST', '/users', adminToken, { branchId, username, password: 'cashier-pass-1', permissions });
    // A counter of their own: the branch's first one may already be open.
    const counter = await ok<{ id: string }>('POST', `/branches/${branchId}/counters`, adminToken, { name: `Till ${username}` });
    const opened = await ok<{ token: string; register: { id: string } }>('POST', '/registers/open', await login(username, 'cashier-pass-1'), {
      branchId,
      counterId: counter.id,
      openingBalance: 0
    });
    return { userId: user.id, username, token: opened.token, registerId: opened.register.id };
  }

  async function item(
    token: string,
    branchId: string,
    opts: { sellPrice?: number; costPrice?: number; taxRate?: number; taxMode?: 'INCLUSIVE' | 'EXCLUSIVE'; stock?: number; saleUoms?: unknown[] } = {}
  ) {
    const created = await ok<{ id: string; code: string }>('POST', '/items', token, {
      code: `I${randomUUID().slice(0, 10)}`,
      name: `Item ${randomUUID().slice(0, 6)}`,
      uom: 'PCS',
      sellPrice: opts.sellPrice ?? 100,
      costPrice: opts.costPrice,
      taxRate: opts.taxRate ?? 0,
      taxMode: opts.taxMode ?? 'EXCLUSIVE',
      saleUoms: opts.saleUoms
    });
    if ((opts.stock ?? 100) > 0) {
      await ok('POST', '/stock/opening', token, { branchId, itemId: created.id, qty: opts.stock ?? 100 });
    }
    return created;
  }

  async function onHand(token: string, branchId: string, itemId: string) {
    const rows = await ok<Array<{ onHand: number }>>('GET', `/stock/on-hand?branchId=${branchId}&itemId=${itemId}`, token);
    return Number(rows[0]?.onHand ?? 0);
  }

  async function close() {
    try {
      await assertStockMatchesLedger(db);
    } finally {
      await db.$disconnect();
      await app.close();
    }
  }

  return { app, baseUrl, db, business, businessCode, inBusiness, call, ok, login, freeBranchCode, newBranch, branchWithRegister, cashierWithRegister, item, onHand, close };
}

export type TestApp = Awaited<ReturnType<typeof startApp>>;

/** A sale line for `item` at its list price. */
export const line = (itemId: string, o: Record<string, unknown> = {}) => ({
  itemId,
  qty: 1,
  rate: 100,
  taxRate: 0,
  taxMode: 'EXCLUSIVE',
  ...o
});

export const checkoutBody = (branchId: string, customerId: string, lines: unknown[], payments: unknown[], extra: Record<string, unknown> = {}) => ({
  branchId,
  customerId,
  lines,
  payments,
  idempotencyKey: randomUUID(),
  ...extra
});

/** On-hand stock (ItemStock) must always equal the sum of the stock ledger. Checked after every test file. */
export async function assertStockMatchesLedger(db: PrismaClient) {
  const mismatches = await db.$queryRaw<Array<{ branchId: string; itemId: string; stock: string; ledger: string }>>`
    SELECT COALESCE(s."branchId", l."branchId") AS "branchId", COALESCE(s."itemId", l."itemId") AS "itemId",
           COALESCE(s.qty, 0)::text AS stock, COALESCE(l.qty, 0)::text AS ledger
    FROM "ItemStock" s
    FULL JOIN (SELECT "branchId", "itemId", SUM("qtyIn" - "qtyOut") AS qty FROM "StockLedger" GROUP BY 1, 2) l
      ON l."branchId" = s."branchId" AND l."itemId" = s."itemId"
    WHERE COALESCE(s.qty, 0) <> COALESCE(l.qty, 0)`;
  if (mismatches.length > 0) {
    throw new Error(`ItemStock differs from the ledger: ${JSON.stringify(mismatches.slice(0, 5))}`);
  }
}

/** Opening stock written straight to the database (ledger and on-hand together, like the app). */
export async function addOpeningStock(db: PrismaClient, branchId: string, itemId: string, qty: number) {
  await db.$transaction([
    db.stockLedger.create({ data: { branchId, itemId, txnType: 'OPENING', qtyIn: qty, qtyOut: 0 } }),
    db.itemStock.upsert({
      where: { branchId_itemId: { branchId, itemId } },
      create: { branchId, itemId, qty },
      update: { qty: { increment: qty } }
    })
  ]);
}
