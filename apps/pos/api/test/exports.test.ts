import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { restoreBackup } from '../src/backup/local-backup';
import { uploadsDir } from '../src/common/uploads';
import { checkoutBody, line, startApp, type TestApp } from './helpers';

// Taking a business's data away: the whole business as a backup an offline install restores,
// and the sales register as CSV.
const apiRoot = new URL('..', import.meta.url).pathname;
const testDb = new URL(process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/pos_test?schema=public');
const restoreDbName = `${testDb.pathname.slice(1)}_export_restore`;
const restoreDbUrl = (() => {
  const url = new URL(testDb);
  url.pathname = `/${restoreDbName}`;
  return url.toString();
})();

let t: TestApp;
let admin: string;
let ctx: Awaited<ReturnType<TestApp['branchWithRegister']>>;
let timeZone: string;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());

beforeAll(async () => {
  t = await startApp();
  admin = await t.login();
  timeZone = (await t.ok('GET', '/business/settings', admin)).timezone;
  ctx = await t.branchWithRegister(admin);
});
afterAll(async () => {
  await t.close();
});

const download = (path: string, token: string) => fetch(t.baseUrl + path, { headers: { authorization: `Bearer ${token}` } });

describe('the whole business', () => {
  it('downloads as a backup file that restores, pictures included', async () => {
    const item = await t.item(ctx.token, ctx.branch.id, { sellPrice: 100 });
    const picture = `items/export-${randomUUID()}.png`;
    await mkdir(join(uploadsDir, 'items'), { recursive: true });
    await writeFile(join(uploadsDir, picture), 'not really a picture');
    await t.db.item.update({ where: { id: item.id }, data: { imageUrl: `/uploads/${picture}` } });
    await t.ok('POST', '/sales/checkout', ctx.token, checkoutBody(ctx.branch.id, ctx.walkIn.id, [line(item.id)], [{ mode: 'CASH', amount: 100 }]));

    // An admin of every branch (other test files add branches of their own).
    const owner = await t.db.user.findUniqueOrThrow({ where: { username: 'admin' } });
    const branches = await t.db.branch.findMany({ select: { id: true } });
    await t.db.userBranchAccess.createMany({ data: branches.map((branch) => ({ userId: owner.id, branchId: branch.id })), skipDuplicates: true });
    const res = await download('/exports/business', admin);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toMatch(/pos-export-.+\.zip/);
    const dir = await mkdtemp(join(tmpdir(), 'pos-export-test-'));
    const file = join(dir, 'export.zip');
    await writeFile(file, Buffer.from(await res.arrayBuffer()));

    const server = new PrismaClient({ datasourceUrl: new URL('/template1', testDb).toString() });
    await server.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${restoreDbName}" WITH (FORCE)`);
    await server.$executeRawUnsafe(`CREATE DATABASE "${restoreDbName}"`);
    await server.$disconnect();
    const manifest = await restoreBackup({ file, databaseUrl: restoreDbUrl, uploadsDir: join(dir, 'uploads'), apiRoot });
    expect(manifest.reason).toBe('export');
    const restored = new PrismaClient({ datasourceUrl: restoreDbUrl });
    try {
      expect(await restored.saleInvoice.count()).toBe(await t.db.saleInvoice.count());
      expect(await restored.customer.count()).toBe(await t.db.customer.count());
      expect(await restored.item.findUnique({ where: { id: item.id }, select: { imageUrl: true } })).toEqual({ imageUrl: `/uploads/${picture}` });
    } finally {
      await restored.$disconnect();
    }
    expect(existsSync(join(dir, 'uploads', ...picture.split('/')))).toBe(true);
  });

  it('is for admins of every branch only', async () => {
    const cashier = await t.cashierWithRegister(admin, ctx.branch.id);
    expect((await download('/exports/business', cashier.token)).status).toBe(403);
    // An admin of one branch only (made from a cashier: the screens have no such step).
    const username = `branch-admin-${randomUUID().slice(0, 8)}`;
    const user = await t.ok('POST', '/users', admin, { branchId: ctx.branch.id, username, password: 'admin-pass-123' });
    await t.db.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
    const partial = await download('/exports/business', await t.login(username, 'admin-pass-123'));
    expect(partial.status).toBe(400);
    expect((await partial.json()).message).toMatch(/admin of every branch/);
  });
});

describe('the sales register', () => {
  it('lists invoices and credit notes with the tax split, safe to open in a spreadsheet', async () => {
    const branch = await t.branchWithRegister(admin);
    const item = await t.item(branch.token, branch.branch.id, { sellPrice: 118, taxRate: 18, taxMode: 'INCLUSIVE' });
    const customer = await t.ok('POST', '/customers', branch.token, { branchId: branch.branch.id, name: '=HYPERLINK("x")', phone: '9333300000' });
    const { invoice } = await t.ok(
      'POST',
      '/sales/checkout',
      branch.token,
      checkoutBody(branch.branch.id, customer.id, [line(item.id, { qty: 2, rate: 118, taxRate: 18, taxMode: 'INCLUSIVE' })], [{ mode: 'CASH', amount: 100 }])
    );
    const ret = await t.ok('POST', `/sales/${invoice.id}/return`, branch.token, { refundMode: 'CASH', reason: 'Test return', lines: [{ saleLineId: invoice.lines[0].id, qty: 1 }] });

    const res = await download(`/exports/sales.csv?branchId=${branch.branch.id}&from=${today()}&to=${today()}`, admin);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/csv/);
    const rows = (await res.text()).replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(rows[0]).toBe(
      'Type,Date,Number,Against invoice,Branch,Customer,Phone,Buyer GSTIN,Place of supply,Taxable value,CGST,SGST,IGST,Round off,Total,Paid,Credited by returns,Owed,Refunded,Status,Payments'
    );
    expect(rows).toHaveLength(3);
    // 236 sold, 100 paid; one returned (118): 118 off what was owed, nothing back.
    expect(rows[1]).toBe(
      `Invoice,${today()},${invoice.invoiceNo},,${branch.branch.code},"'=HYPERLINK(""x"")",9333300000,,29 - Karnataka,200,18,18,0,0,236,100,118,18,,Part paid,CASH 100.00`
    );
    expect(rows[2]).toBe(`Credit note,${today()},${ret.returnNo},${invoice.invoiceNo},${branch.branch.code},"'=HYPERLINK(""x"")",9333300000,,29 - Karnataka,-100,-9,-9,0,0,-118,,,,0,,`);

    // Admins only; a period the right way round.
    const cashier = await t.cashierWithRegister(admin, branch.branch.id);
    expect((await download(`/exports/sales.csv?from=${today()}&to=${today()}`, cashier.token)).status).toBe(403);
    expect((await download(`/exports/sales.csv?from=${today()}&to=2000-01-01`, admin)).status).toBe(400);
  });
});
