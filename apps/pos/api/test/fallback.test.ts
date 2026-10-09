import { execSync, spawn, type ChildProcess } from 'child_process';
import { randomBytes, randomUUID } from 'crypto';
import { mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createInterface } from 'readline';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { FALLBACK_SYNC_CONFLICT, FALLBACK_UNAVAILABLE } from '@pos/contracts';
import { restoreBackup } from '../src/backup/local-backup';
import { addDays } from '../src/suppliers/supplier-ledger';
import { ADMIN, checkoutBody, line, startApp, type TestApp } from './helpers';

// A fallback counter: the online server binds it to one computer and gives that computer a copy
// of what selling needs; the computer's local API (fallback mode, a child process here) sells
// while the server can't be reached; its sales then go back to the server.
const apiRoot = new URL('..', import.meta.url).pathname;
const build = join(apiRoot, 'node_modules', '.cache', 'pos-fallback-test-build');
const testDb = new URL(process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/pos_test?schema=public');
const localDbName = `${testDb.pathname.slice(1)}_fallback_local`;
const localDbUrl = (() => {
  const url = new URL(testDb);
  url.pathname = `/${localDbName}`;
  return url.toString();
})();

let t: TestApp;
let admin: string;
let branchId: string;
let counterId: string;
let counterNumber: number;
let branchCode: string;
let key: string;
let itemId: string;
let walkInId: string;
let registerToken: string;
let creditCoId: string;
let copiedSale: { id: string; lines: Array<{ id: string }> };
let freshExpiry: string;
let groupId: string;
const deviceId = randomUUID();
const device = { 'x-pos-device': deviceId };

async function call(base: string, method: string, path: string, options: { token?: string; headers?: Record<string, string>; body?: unknown } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...options.headers
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await res.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: res.status, body, res };
}

beforeAll(async () => {
  execSync(`npx tsc -p tsconfig.build.json --outDir ${build}`, { cwd: apiRoot, stdio: 'pipe' });
  t = await startApp();
  admin = await t.login();
  const branch = await t.newBranch(admin, 'Fallback');
  branchId = branch.id;
  branchCode = branch.code;
  const counters = await t.ok('GET', `/branches/${branchId}/counters`, admin);
  counterId = counters[0].id;
  counterNumber = counters[0].number;
}, 120_000);

let local: ChildProcess | null = null;
afterAll(async () => {
  local?.kill();
  await t.close();
});

describe('fallback counter, on the server', () => {
  it('is bound to one computer, which alone may open it', async () => {
    const set = await call(t.baseUrl, 'POST', `/counters/${counterId}/fallback`, { token: admin, body: { deviceId } });
    expect(set.status).toBe(200);
    key = set.body.key;
    expect(key).toMatch(/^fb1\./);
    expect(set.body.counter.fallbackDeviceId).toBe(deviceId);

    const elsewhere = await call(t.baseUrl, 'POST', '/registers/open', { token: admin, headers: { 'x-pos-device': randomUUID() }, body: { branchId, counterId, openingBalance: 0 } });
    expect(elsewhere.status).toBe(400);
    expect(elsewhere.body.message).toMatch(/fallback counter/);
    const here = await call(t.baseUrl, 'POST', '/registers/open', { token: admin, headers: device, body: { branchId, counterId, openingBalance: 100 } });
    expect(here.status).toBe(200);
    registerToken = here.body.token;

    // An item, its stock, and one sale online, so the counter's series is at 1.
    const item = await t.item(registerToken, branchId, { sellPrice: 118, taxRate: 18, taxMode: 'INCLUSIVE', stock: 0 });
    itemId = item.id;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    freshExpiry = addDays(today, 30);
    const group = await t.db.itemGroup.create({ data: { name: `Fallback variants ${randomUUID()}`, option1Name: 'Size', option1Values: ['Standard'], option2Values: [] } });
    groupId = group.id;
    await t.db.item.update({ where: { id: itemId }, data: { tracksBatches: true, groupId, option1: 'Standard' } });
    await t.ok('POST', '/stock/opening', registerToken, { branchId, itemId, qty: 20, batchNo: 'LIVE', expiryDate: freshExpiry });
    await t.ok('POST', '/stock/opening', registerToken, { branchId, itemId, qty: 4, batchNo: 'OLD', expiryDate: addDays(today, -1) });
    walkInId = (await t.ok('GET', `/customers/walk-in/${branchId}`, registerToken)).id;
    const sale = await t.ok('POST', '/sales/checkout', registerToken, checkoutBody(branchId, walkInId, [line(itemId, { qty: 2, rate: 118, taxRate: 18, taxMode: 'INCLUSIVE' })], [{ mode: 'CASH', amount: 236 }]));
    expect(sale.invoice.invoiceNo).toMatch(new RegExp(`^${branchCode}/${counterNumber}/\\d{2}/00001$`));
    copiedSale = sale.invoice;
    await t.ok('POST', `/sales/${copiedSale.id}/return`, registerToken, { lines: [{ saleLineId: copiedSale.lines[0].id, qty: 1 }], refundMode: 'CASH', reason: 'Returned before snapshot' });

    // A customer with a credit limit who owes 118 from a credit sale at another branch.
    const other = await t.branchWithRegister(admin);
    await t.ok('POST', '/stock/opening', other.token, { branchId: other.branch.id, itemId, qty: 5, batchNo: 'LIVE', expiryDate: freshExpiry });
    creditCoId = (await t.ok('POST', '/customers', admin, { branchId: other.branch.id, name: 'Credit Co', creditLimit: 300 })).id;
    await t.ok('POST', '/sales/checkout', other.token, checkoutBody(other.branch.id, creditCoId, [line(itemId, { rate: 118, taxRate: 18, taxMode: 'INCLUSIVE' })], []));
  });

  it('refuses a wrong or missing key', async () => {
    expect((await call(t.baseUrl, 'GET', '/fallback/snapshot')).status).toBe(401);
    expect((await call(t.baseUrl, 'GET', '/fallback/snapshot', { headers: { 'x-pos-fallback-key': `${key.slice(0, -4)}AAAA` } })).status).toBe(401);
  });
});

describe('fallback counter, working offline', () => {
  let base = '';
  let localToken = '';
  let offlineInvoiceId = '';
  const secret = randomBytes(32).toString('base64url');

  it("loads the server's copy into a database of its own and sells from it", async () => {
    const snapshot = await fetch(`${t.baseUrl}/fallback/snapshot`, { headers: { 'x-pos-fallback-key': key } });
    expect(snapshot.status).toBe(200);
    const dir = await mkdtemp(join(tmpdir(), 'pos-fallback-test-'));
    const file = join(dir, 'copy.zip');
    await writeFile(file, Buffer.from(await snapshot.arrayBuffer()));

    const server = new PrismaClient({ datasourceUrl: new URL('/template1', testDb).toString() });
    await server.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${localDbName}" WITH (FORCE)`);
    await server.$executeRawUnsafe(`CREATE DATABASE "${localDbName}"`);
    await server.$disconnect();
    const manifest = await restoreBackup({ file, databaseUrl: localDbUrl, uploadsDir: join(dir, 'uploads'), apiRoot });
    const tables = Object.fromEntries(manifest.tables.map((table) => [table.name, table.rows]));
    // What selling needs; of the sales history only the counter's own recent paid bills (for
    // returns), and what customers owe.
    expect(tables.Counter).toBeGreaterThanOrEqual(1);
    expect(tables.RegisterSession).toBe(1);
    expect(tables.DocumentSequence).toBe(2);
    expect(tables.SaleInvoice).toBe(1);
    expect(tables.FallbackCopiedDocument).toBe(2);
    expect(tables.ReturnInvoice).toBe(1);
    expect(tables.ItemBatch).toBe(2);
    expect(tables.BatchStock).toBe(2);
    expect(tables.StockLedger).toBe(2);
    expect(tables.ItemGroup).toBeGreaterThanOrEqual(1);
    expect(tables.FallbackRegisterBalance).toBe(1);
    expect(tables.ItemStock).toBe(1);
    const copy = new PrismaClient({ datasourceUrl: localDbUrl });
    try {
      expect((await copy.fallbackBalance.findMany()).map((row) => [row.customerId, Number(row.owed)])).toContainEqual([creditCoId, 118]);
      expect(await copy.saleInvoice.findMany({ select: { id: true } })).toEqual([{ id: copiedSale.id }]);
    } finally {
      await copy.$disconnect();
    }

    local = spawn(process.execPath, [join(build, 'main.js')], {
      env: {
        ...process.env,
        POS_MODE: 'offline',
        POS_FALLBACK: '1',
        POS_FALLBACK_COUNTER_ID: counterId,
        POS_FALLBACK_SECRET: secret,
        DATABASE_URL: localDbUrl,
        PORT: '0',
        HOST: '127.0.0.1',
        UPLOADS_DIR: join(dir, 'uploads')
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const port = await new Promise<number>((resolve, reject) => {
      const lines = createInterface({ input: local!.stdout! });
      lines.on('line', (text) => {
        if (text.startsWith('{"event":"listening"')) resolve(JSON.parse(text).port);
      });
      local!.on('exit', (code) => reject(new Error(`The local API stopped (${code})`)));
    });
    base = `http://127.0.0.1:${port}`;

    // A sale online after the copy was made: the app saw its number and catches the copy up.
    const later = await t.ok('POST', '/sales/checkout', registerToken, checkoutBody(branchId, walkInId, [line(itemId, { rate: 118, taxRate: 18, taxMode: 'INCLUSIVE' })], [{ mode: 'CASH', amount: 118 }]));
    expect(later.invoice.invoiceNo).toMatch(/\/00002$/);
    const caughtUp = await call(base, 'POST', '/fallback/numbers', {
      headers: { 'x-pos-fallback-secret': secret },
      body: { invoiceNumbers: [later.invoice.invoiceNo, 'XYZ/9/26/00500'] }
    });
    expect(caughtUp.body.moved).toBe(1);
    expect((await call(base, 'POST', '/fallback/numbers', { body: { invoiceNumbers: [] } })).status).toBe(401);

    // Staff sign in as usual and carry on with the register that was open.
    const login = await call(base, 'POST', '/auth/login', { body: { username: ADMIN.username, password: ADMIN.password } });
    expect(login.status).toBe(200);
    expect(login.body.registerId).toBeTruthy();
    localToken = login.body.token;
    const current = await call(base, 'GET', '/registers/current', { token: localToken });
    expect(current.body).toMatchObject({ cashSales: 236, cashRefunds: 118, expectedCash: 218 });
    const groups = await call(base, 'GET', '/item-groups', { token: localToken });
    expect(groups.status).toBe(200);
    expect(groups.body.some((group: { id: string }) => group.id === groupId)).toBe(true);

    const sale = await call(base, 'POST', '/sales/checkout', {
      token: localToken,
      headers: device,
      body: checkoutBody(branchId, walkInId, [line(itemId, { qty: 2, rate: 118, taxRate: 18, taxMode: 'INCLUSIVE' })], [{ mode: 'CASH', amount: 236 }])
    });
    expect(sale.status).toBe(200);
    // The counter's own series carries on; receipts have a series of the counter's own.
    expect(sale.body.invoice.invoiceNo).toMatch(new RegExp(`^${branchCode}/${counterNumber}/\\d{2}/00003$`));
    expect(sale.body.receipt.receiptNo).toMatch(new RegExp(`-${branchCode}-F${counterNumber}-000001$`));
    offlineInvoiceId = sale.body.invoice.id;
    expect(sale.body.invoice.lines[0].batches).toEqual([{ batchNo: 'LIVE', expiryDate: freshExpiry, qty: 2 }]);
  });

  it('does only what needs no server', async () => {
    const localDb = new PrismaClient({ datasourceUrl: localDbUrl });
    try {
      await localDb.businessSettings.update({ where: { id: 'default' }, data: { allowNegativeStock: true } });
      const fresh = await localDb.batchStock.findFirstOrThrow({ where: { branchId, batch: { itemId, batchNo: 'LIVE' } } });
      const qty = Number(fresh.qty) + 1;
      const before = await localDb.stockLedger.count();
      const expired = await call(base, 'POST', '/sales/checkout', { token: localToken,
        body: checkoutBody(branchId, walkInId, [line(itemId, { qty, rate: 118, taxRate: 18, taxMode: 'INCLUSIVE' })], [{ mode: 'CASH', amount: qty * 118 }]) });
      expect(expired.status).toBe(400);
      expect(expired.body.message).toMatch(/expired stock/);
      expect(await localDb.stockLedger.count()).toBe(before);
    } finally {
      await localDb.businessSettings.update({ where: { id: 'default' }, data: { allowNegativeStock: false } });
      await localDb.$disconnect();
    }
    const edit = await call(base, 'PATCH', `/customers/${creditCoId}`, { token: localToken, body: { name: 'Renamed' } });
    expect(edit.status).toBe(403);
    expect(edit.body.code).toBe(FALLBACK_UNAVAILABLE);
    const wallet = await call(base, 'POST', '/sales/checkout', {
      token: localToken,
      body: checkoutBody(branchId, walkInId, [line(itemId, { rate: 118, taxRate: 18, taxMode: 'INCLUSIVE' })], [{ mode: 'WALLET', amount: 118 }])
    });
    expect(wallet.status).toBe(400);
    expect(wallet.body.message).toMatch(/wallet/i);
    expect((await call(base, 'GET', '/fallback/outbox')).status).toBe(401);
  });

  it('sends its sales to the server once, with stock and numbering', async () => {
    const outbox = await call(base, 'GET', '/fallback/outbox', { headers: { 'x-pos-fallback-secret': secret } });
    expect(outbox.status).toBe(200);
    expect(outbox.body.invoices).toHaveLength(1);
    expect(outbox.body.receiptSeq).toBe(1);

    // Meanwhile all but one of batch LIVE, which the offline sale took 2 from, went online.
    const live = await t.db.batchStock.findFirstOrThrow({ where: { branchId, batch: { itemId, batchNo: 'LIVE' } } });
    const liveKey = { branchId_batchId: { branchId, batchId: live.batchId } };
    const gone = Number(live.qty) - 1;
    const adjust = (direction: 'IN' | 'OUT') =>
      t.ok('POST', '/stock/adjustment', registerToken, { branchId, itemId, qty: gone, direction, reason: 'Sold at another till', batchNo: 'LIVE' });
    await adjust('OUT');
    const stockBefore = await t.onHand(registerToken, branchId, itemId);
    const sync = await call(t.baseUrl, 'POST', '/fallback/sync', { headers: { 'x-pos-fallback-key': key }, body: outbox.body });
    expect(sync.status).toBe(200);
    expect(sync.body.invoices).toBe(1);
    // Sent again (a retry after a lost answer): nothing changes.
    const again = await call(t.baseUrl, 'POST', '/fallback/sync', { headers: { 'x-pos-fallback-key': key }, body: outbox.body });
    expect(again.body.invoices).toBe(0);
    expect(await t.onHand(registerToken, branchId, itemId)).toBe(stockBefore - 2);
    // The batch gave the one it had; the other is counted without a batch, and flagged for the admin.
    expect(Number((await t.db.batchStock.findUniqueOrThrow({ where: liveKey })).qty)).toBe(0);
    const moves = await t.db.stockLedger.findMany({ where: { referenceId: offlineInvoiceId }, select: { batchId: true, qtyOut: true } });
    expect(moves.map((move) => [move.batchId, Number(move.qtyOut)]).sort()).toEqual([[live.batchId, 1], [null, 1]].sort());
    const flags = await t.db.auditEvent.findMany({ where: { action: 'OFFLINE_BATCH_SHORT', entityId: live.batchId } });
    expect(flags).toHaveLength(1);
    expect(flags[0].summary).toMatch(/took 1 more from batch LIVE/);
    // The other till's goods back, for the tests that follow.
    await adjust('IN');

    const invoice = await t.ok('GET', `/sales/${offlineInvoiceId}`, registerToken);
    expect(invoice.payments).toHaveLength(1);
    // The next sale online continues after the offline one.
    const next = await t.ok('POST', '/sales/checkout', registerToken, checkoutBody(branchId, walkInId, [line(itemId, { rate: 118, taxRate: 18, taxMode: 'INCLUSIVE' })], [{ mode: 'CASH', amount: 118 }]));
    expect(next.invoice.invoiceNo).toMatch(/\/00004$/);
  });

  it('adds customers, sells on credit, takes payments and returns offline, and sends them', async () => {
    const local = (method: string, path: string, body?: unknown) => call(base, method, path, { token: localToken, headers: device, body });
    const sell = (customerId: string, qty: number, payments: unknown[]) =>
      local('POST', '/sales/checkout', checkoutBody(branchId, customerId, [line(itemId, { qty, rate: 118, taxRate: 18, taxMode: 'INCLUSIVE' })], payments));

    // Back online the counter sold more; the app catches the copy's numbering up before selling.
    const lastOnline = await t.db.saleInvoice.findFirstOrThrow({ where: { branchId, documentSeries: `${branchCode}/${counterNumber}` }, orderBy: { invoiceNo: 'desc' } });
    await call(base, 'POST', '/fallback/numbers', { headers: { 'x-pos-fallback-secret': secret }, body: { invoiceNumbers: [lastOnline.invoiceNo] } });

    // Credit: what they owed when the copy was made counts.
    const owedBefore = await local('GET', `/customers/${creditCoId}/account`);
    expect(owedBefore.body).toMatchObject({ outstanding: 118, creditLimit: 300, available: 182 });
    const credit = await sell(creditCoId, 1, []);
    expect(credit.status).toBe(200);
    expect(credit.body.invoice.status).toBe('DRAFT');
    expect((await local('GET', `/customers/${creditCoId}/account`)).body).toMatchObject({ outstanding: 236, available: 64 });

    // Cancellation is outside the fallback write allowlist. It must never create an
    // unsyncable CANCELLED bill, nor put its stock back locally.
    const localDb = new PrismaClient({ datasourceUrl: localDbUrl });
    try {
      const beforeStock = await localDb.itemStock.findUniqueOrThrow({ where: { branchId_itemId: { branchId, itemId } } });
      const beforeLedger = await localDb.stockLedger.findMany({ where: { referenceId: credit.body.invoice.id } });
      const rejected = await local('POST', `/sales/${credit.body.invoice.id}/cancel`, { reason: 'Customer left' });
      expect(rejected.status).toBe(403);
      expect(rejected.body.code).toBe(FALLBACK_UNAVAILABLE);
      expect((await localDb.saleInvoice.findUniqueOrThrow({ where: { id: credit.body.invoice.id } })).status).toBe('DRAFT');
      expect(await localDb.stockLedger.findMany({ where: { referenceId: credit.body.invoice.id } })).toEqual(beforeLedger);
      expect(await localDb.itemStock.findUniqueOrThrow({ where: { branchId_itemId: { branchId, itemId } } })).toEqual(beforeStock);
    } finally {
      await localDb.$disconnect();
    }

    // A new customer, sold to on credit, then paying part of it.
    const shop = await local('POST', '/customers', { branchId, name: 'Offline Shop', phone: '9111100000' });
    expect(shop.status).toBe(201);
    expect(shop.body.code).toMatch(/^OFF-[0-9A-F]{8}$/);
    const shopSale = await sell(shop.body.id, 1, []);
    const settlementKey = randomUUID();
    const settlementBody = { payments: [{ mode: 'CASH', amount: 50 }], idempotencyKey: settlementKey };
    const paid = await local('POST', `/sales/${shopSale.body.invoice.id}/settle`, settlementBody);
    expect(paid.status).toBe(200);
    expect(paid.body.invoice.status).toBe('PARTIALLY_SETTLED');
    const retry = await local('POST', `/sales/${shopSale.body.invoice.id}/settle`, settlementBody);
    expect(retry.status).toBe(200);
    expect(retry.body.receipt.id).toBe(paid.body.receipt.id);
    expect(retry.body.invoice.paidTotal).toBe('50');
    // The wallet stays out of it offline.
    expect((await local('POST', `/sales/${shopSale.body.invoice.id}/settle`, { idempotencyKey: randomUUID(), payments: [{ mode: 'CASH', amount: 500 }] })).status).toBe(400);

    // A customer the server added after the copy was made, added again offline by phone.
    const late = await t.ok('POST', '/customers', admin, { branchId, name: 'Late Online', phone: '9222200000' });
    const lateHere = await local('POST', '/customers', { branchId, name: 'Late (offline)', phone: '9222200000' });
    const lateSale = await sell(lateHere.body.id, 1, [{ mode: 'CASH', amount: 118 }]);

    // Returns: of a paid bill that came with the copy (cash back), and of the new customer's
    // credit bill (68 off what they owe, 50 back). Never into the wallet offline.
    expect((await local('POST', `/sales/${copiedSale.id}/return`, { refundMode: 'WALLET', reason: 'Test return', lines: [{ saleLineId: copiedSale.lines[0].id, qty: 1 }] })).status).toBe(400);
    const copiedReturn = await local('POST', `/sales/${copiedSale.id}/return`, { refundMode: 'CASH', reason: 'Test return', lines: [{ saleLineId: copiedSale.lines[0].id, qty: 1 }] });
    expect(copiedReturn.status).toBe(201);
    expect(copiedReturn.body.returnNo).toMatch(new RegExp(`^${branchCode}R/${counterNumber}/\\d{2}/00002$`));
    const shopReturn = await local('POST', `/sales/${shopSale.body.invoice.id}/return`, { refundMode: 'CASH', reason: 'Test return', lines: [{ saleLineId: shopSale.body.invoice.lines[0].id, qty: 1 }] });
    expect(shopReturn.body).toMatchObject({ dueAdjusted: '68', refundAmount: '50' });

    const outbox = await call(base, 'GET', '/fallback/outbox', { headers: { 'x-pos-fallback-secret': secret } });
    expect(outbox.body.customers.map((row: { name: string }) => row.name).sort()).toEqual(['Late (offline)', 'Offline Shop']);
    expect(outbox.body.returns).toHaveLength(2);
    // The bill that came with the copy isn't sent back as new.
    expect(outbox.body.invoices.map((entry: { invoice: { id: string } }) => entry.invoice.id)).not.toContain(copiedSale.id);

    const stockBefore = await t.onHand(registerToken, branchId, itemId);
    const sync = await call(t.baseUrl, 'POST', '/fallback/sync', { headers: { 'x-pos-fallback-key': key }, body: outbox.body });
    expect(sync.body).toMatchObject({ invoices: 3, customers: 1, returns: 2 });
    // Sold 3, 2 came back.
    expect(await t.onHand(registerToken, branchId, itemId)).toBe(stockBefore - 1);

    // A lost offline answer retried after reconnecting reuses the receipt imported by sync.
    const onlineRetry = await t.call('POST', `/sales/${shopSale.body.invoice.id}/settle`, registerToken, settlementBody);
    expect(onlineRetry.status).toBe(200);
    expect(onlineRetry.body.receipt.id).toBe(paid.body.receipt.id);
    expect(await t.db.payment.count({ where: { invoiceId: shopSale.body.invoice.id } })).toBe(1);

    // The new customer, with a code from the server and a wallet; what they owe is right.
    const added = await t.db.customer.findUniqueOrThrow({ where: { id: shop.body.id } });
    expect(added.code).toMatch(new RegExp(`^CUST-${branchCode}-\\d{6}$`));
    expect(await t.ok('GET', `/customers/${shop.body.id}/wallet?branchId=${branchId}`, admin)).toMatchObject({ balance: 0 });
    expect(await t.ok('GET', `/customers/${shop.body.id}/account?branchId=${branchId}`, admin)).toMatchObject({ outstanding: 0 });
    expect(await t.ok('GET', `/customers/${creditCoId}/account?branchId=${branchId}`, admin)).toMatchObject({ outstanding: 236 });
    // The customer added twice is one: the offline bill is theirs.
    expect((await t.db.saleInvoice.findUniqueOrThrow({ where: { id: lateSale.body.invoice.id } })).customerId).toBe(late.id);
    expect(await t.db.customer.findUnique({ where: { id: lateHere.body.id } })).toBeNull();
    // The copied bill's return is on the server's bill.
    expect(await t.db.returnInvoice.count({ where: { saleInvoiceId: copiedSale.id } })).toBe(2);

    // Sent again: nothing changes.
    const again = await call(t.baseUrl, 'POST', '/fallback/sync', { headers: { 'x-pos-fallback-key': key }, body: outbox.body });
    expect(again.body).toMatchObject({ invoices: 0, customers: 0, returns: 0 });

    // The same goods returned again (another return made offline): a clash, nothing added.
    const twice = structuredClone(outbox.body);
    const copied = twice.returns.find((entry: { ret: { saleInvoiceId: string } }) => entry.ret.saleInvoiceId === copiedSale.id);
    copied.ret.id = randomUUID();
    copied.ret.returnNo = copied.ret.returnNo.replace(/\d{5}$/, '00009');
    for (const row of [...copied.lines, ...copied.ledger]) {
      row.id = randomUUID();
      if ('returnInvoiceId' in row) row.returnInvoiceId = copied.ret.id;
      if ('referenceId' in row) row.referenceId = copied.ret.id;
    }
    const refused = await call(t.baseUrl, 'POST', '/fallback/sync', { headers: { 'x-pos-fallback-key': key }, body: twice });
    expect(refused.status).toBe(409);
    expect(refused.body.conflicts).toEqual([
      { document: `Return ${copied.ret.returnNo}`, problem: expect.stringMatching(/would be returned on .+ than was sold/) },
      { document: `Return ${copied.ret.returnNo}`, problem: expect.stringMatching(/More money would be handed back/) },
      // The server's own check of the returned amounts says so too.
      { document: `Return ${copied.ret.returnNo}`, problem: expect.stringMatching(/would be given back than was sold/) }
    ]);
  });

  it('lists the item pictures the copy shows, for the app to keep', async () => {
    const localDb = new PrismaClient({ datasourceUrl: localDbUrl });
    try {
      await localDb.item.update({ where: { id: itemId }, data: { imageUrl: '/uploads/items/fallback-test.png' } });
      const images = await call(base, 'GET', '/fallback/images', { headers: { 'x-pos-fallback-secret': secret } });
      expect(images.body.paths).toEqual(['/uploads/items/fallback-test.png']);
      expect((await call(base, 'GET', '/fallback/images')).status).toBe(401);
    } finally {
      await localDb.item.update({ where: { id: itemId }, data: { imageUrl: null } });
      await localDb.$disconnect();
    }
  });

  it('names every clash with the server and adds nothing', async () => {
    const outbox = await call(base, 'GET', '/fallback/outbox', { headers: { 'x-pos-fallback-secret': secret } });
    // The same invoice and receipt numbers as the sale already sent, under new ids, selling an
    // item the server doesn't have.
    const clashing = structuredClone(outbox.body);
    const entry = clashing.invoices[0];
    const id = randomUUID();
    entry.invoice.id = id;
    for (const row of [...entry.lines, ...entry.payments, ...entry.receipts]) {
      row.id = randomUUID();
      row.invoiceId = id;
    }
    for (const row of entry.discounts) row.saleInvoiceId = id;
    for (const row of entry.ledger) {
      row.id = randomUUID();
      row.referenceId = id;
    }
    entry.lines[0].itemId = randomUUID();
    for (const row of entry.ledger) row.itemId = entry.lines[0].itemId;
    const invoicesBefore = await t.db.saleInvoice.count();

    const refused = await call(t.baseUrl, 'POST', '/fallback/sync', { headers: { 'x-pos-fallback-key': key }, body: clashing });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: FALLBACK_SYNC_CONFLICT, message: expect.stringMatching(/4 places. Nothing was added/) });
    expect(refused.body.conflicts).toEqual([
      { document: `Stock movement ${entry.ledger[0].id}`, problem: expect.stringMatching(/batch does not belong/) },
      { document: `Invoice ${entry.invoice.invoiceNo}`, problem: expect.stringMatching(/also used online/) },
      { document: `Receipt ${entry.receipts[0].receiptNo}`, problem: expect.stringMatching(/also used online/) },
      { document: `Invoice ${entry.invoice.invoiceNo}`, problem: expect.stringMatching(/item ".+" is no longer on the server/) }
    ]);
    expect(await t.db.saleInvoice.count()).toBe(invoicesBefore);
  });

  it('works the money, stock and returns out again, and refuses rows changed on that computer', async () => {
    const outbox = await call(base, 'GET', '/fallback/outbox', { headers: { 'x-pos-fallback-secret': secret } });
    const sync = (body: unknown) => call(t.baseUrl, 'POST', '/fallback/sync', { headers: { 'x-pos-fallback-key': key }, body });
    // Untouched, it goes through (nothing new to add).
    expect((await sync(outbox.body)).status).toBe(200);

    const paidIndex = outbox.body.invoices.findIndex((entry: { payments: unknown[] }) => entry.payments.length > 0);
    const refusedWith = async (change: (body: any) => string, problem: RegExp) => {
      const body = structuredClone(outbox.body);
      const document = change(body);
      const res = await sync(body);
      expect(res.status, String(problem)).toBe(409);
      expect(res.body.conflicts, String(problem)).toContainEqual({ document, problem: expect.stringMatching(problem) });
    };
    const ledgerBefore = await t.db.stockLedger.count();

    await refusedWith((body) => {
      const entry = body.invoices[paidIndex];
      entry.invoice.grandTotal = Number(entry.invoice.grandTotal) - 50;
      return `Invoice ${entry.invoice.invoiceNo}`;
    }, /totals don't match its lines/);
    await refusedWith((body) => {
      const entry = body.invoices[paidIndex];
      entry.ledger[0].qtyOut = Number(entry.ledger[0].qtyOut) / 2;
      return `Invoice ${entry.invoice.invoiceNo}`;
    }, /stock movements don't match what was sold/);
    await refusedWith((body) => {
      const entry = body.invoices[paidIndex];
      entry.payments[0].mode = 'WALLET';
      return `Invoice ${entry.invoice.invoiceNo}`;
    }, /paid in a way that needs the server/);
    await refusedWith((body) => {
      const entry = body.invoices[paidIndex];
      entry.payments[0].amount = Number(entry.payments[0].amount) + 100;
      return `Invoice ${entry.invoice.invoiceNo}`;
    }, /payments don't match/);
    await refusedWith((body) => {
      const entry = body.invoices[paidIndex];
      entry.lines[0].rate = Number(entry.lines[0].listRate) + 10;
      return `Invoice ${entry.invoice.invoiceNo}`;
    }, /above its list price/);
    await refusedWith((body) => {
      const entry = body.returns[0];
      entry.ret.refundAmount = Number(entry.ret.refundAmount) + 100;
      entry.ret.totalAmount = Number(entry.ret.totalAmount) + 100;
      return `Return ${entry.ret.returnNo}`;
    }, /total doesn't match its lines and refund/);
    await refusedWith((body) => {
      const entry = body.returns[0];
      entry.ledger[0].qtyIn = Number(entry.ledger[0].qtyIn) + 5;
      return `Return ${entry.ret.returnNo}`;
    }, /stock movements don't match what came back/);
    expect(await t.db.stockLedger.count()).toBe(ledgerBefore);
  });

  it('recomputes an offline close from all server payments and ignores a supplied expected balance', async () => {
    const localCurrent = await call(base, 'GET', '/registers/current', { token: localToken });
    expect(localCurrent.status).toBe(200);
    const actual = await t.ok('GET', '/registers/current', registerToken);
    // Two more online sales after the snapshot: the server must include them at reconciliation.
    expect(actual.expectedCash - localCurrent.body.expectedCash).toBe(236);
    const closed = await call(base, 'POST', '/registers/close', { token: localToken, body: { closingBalance: actual.expectedCash } });
    expect(closed.status).toBe(200);
    const outbox = await call(base, 'GET', '/fallback/outbox', { headers: { 'x-pos-fallback-secret': secret } });
    const reg = outbox.body.registers[0];
    reg.expectedCash = '999999';
    reg.cashDifference = '-999999';
    const sync = await call(t.baseUrl, 'POST', '/fallback/sync', { headers: { 'x-pos-fallback-key': key }, body: outbox.body });
    expect(sync.status).toBe(200);
    const saved = await t.db.registerSession.findUniqueOrThrow({ where: { id: reg.id } });
    expect(Number(saved.expectedCash)).toBe(actual.expectedCash);
    expect(Number(saved.closingBalance)).toBe(actual.expectedCash);
    expect(Number(saved.cashDifference)).toBe(0);
    const again = await call(t.baseUrl, 'POST', '/fallback/sync', { headers: { 'x-pos-fallback-key': key }, body: outbox.body });
    expect(again.status).toBe(200);
    expect((await t.db.registerSession.findUniqueOrThrow({ where: { id: reg.id } })).expectedCash).toEqual(saved.expectedCash);
  });

  it('closes the online register an offline one replaced, with its expected cash and no count', async () => {
    const outbox = await call(base, 'GET', '/fallback/outbox', { headers: { 'x-pos-fallback-secret': secret } });
    const openedOnline = await call(t.baseUrl, 'POST', '/registers/open', { token: admin, headers: device, body: { branchId, counterId, openingBalance: 100 } });
    expect(openedOnline.status).toBe(200);
    await t.ok('POST', '/sales/checkout', openedOnline.body.token, checkoutBody(branchId, walkInId, [line(itemId, { rate: 118, taxRate: 18, taxMode: 'INCLUSIVE' })], [{ mode: 'CASH', amount: 118 }]));
    const online = await t.db.registerSession.findUniqueOrThrow({ where: { id: openedOnline.body.register.id } });
    // A register opened offline when the copy didn't know about the one still open online.
    const opened = { ...online, id: randomUUID(), openedAt: new Date().toISOString(), openingBalance: '0', closedAt: null };
    const sync = await call(t.baseUrl, 'POST', '/fallback/sync', {
      headers: { 'x-pos-fallback-key': key },
      body: { ...outbox.body, registers: [opened], invoices: [], sequences: [], customers: [], returns: [] }
    });
    expect(sync.status).toBe(200);

    const closed = await t.db.registerSession.findUniqueOrThrow({ where: { id: online.id } });
    const cash = await t.db.payment.aggregate({ where: { registerSessionId: online.id, mode: 'CASH' }, _sum: { amount: true } });
    expect(closed.closedAt).toEqual(new Date(opened.openedAt));
    // Cash taken, less cash handed back for returns.
    const refunds = await t.db.returnInvoice.aggregate({ where: { registerSessionId: online.id, refundMode: 'CASH' }, _sum: { refundAmount: true } });
    expect(Number(closed.expectedCash)).toBe(Number(closed.openingBalance) + Number(cash._sum.amount) - Number(refunds._sum.refundAmount ?? 0));
    expect(closed.closingBalance).toBeNull();
    expect(closed.cashDifference).toBeNull();
  });

  it("refuses another counter's rows", async () => {
    const outbox = await call(base, 'GET', '/fallback/outbox', { headers: { 'x-pos-fallback-secret': secret } });
    const tampered = structuredClone(outbox.body);
    tampered.invoices[0].invoice.id = randomUUID();
    tampered.invoices[0].invoice.documentSeries = 'XXX/9';
    expect((await call(t.baseUrl, 'POST', '/fallback/sync', { headers: { 'x-pos-fallback-key': key }, body: tampered })).status).toBe(403);
  });

  it('stops working for the computer once it is an ordinary counter again', async () => {
    expect((await call(t.baseUrl, 'DELETE', `/counters/${counterId}/fallback`, { token: admin })).status).toBe(200);
    expect((await call(t.baseUrl, 'GET', '/fallback/snapshot', { headers: { 'x-pos-fallback-key': key } })).status).toBe(401);
  });
});
