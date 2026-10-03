import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  assertRestorable,
  backupFileName,
  clampBackupDays,
  createBackup,
  listBackups,
  migrateDatabaseUpTo,
  pruneBackups,
  restoreBackup,
  type BackupManifest
} from '../src/backup/local-backup';
import { checkoutBody, line, startApp, type TestApp } from './helpers';

// Desktop backups, on their own database (a restore renames databases).
const env = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('fs');
  const { tmpdir } = await import('os');
  const { join } = await import('path');
  const base = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/pos_test?schema=public';
  const url = new URL(base);
  url.pathname = '/pos_backup_test';
  process.env.DATABASE_URL = url.toString();
  process.env.UPLOADS_DIR = mkdtempSync(join(tmpdir(), 'pos-backup-uploads-'));
  return { databaseUrl: url.toString(), uploadsDir: process.env.UPLOADS_DIR };
});

const apiRoot = new URL('..', import.meta.url).pathname;
const migrations = readdirSync(join(apiRoot, 'prisma', 'migrations'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

function resetDatabase(url: string) {
  execSync('npx prisma migrate reset --force --skip-seed --skip-generate', { cwd: apiRoot, env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
}

function databaseUrl(name: string) {
  const url = new URL(env.databaseUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

let t: TestApp;
let backupDir: string;

beforeAll(async () => {
  resetDatabase(env.databaseUrl);
  backupDir = await mkdtemp(join(tmpdir(), 'pos-backups-'));
  t = await startApp();
});
afterAll(async () => {
  await t?.close().catch(() => undefined);
});

/** A sale, so the backup has money, stock and documents in it. */
async function makeSale() {
  const admin = await t.login();
  const ctx = await t.branchWithRegister(admin);
  const item = await t.item(ctx.token, ctx.branch.id, { sellPrice: 99.5, stock: 10 });
  const sale = await t.ok<{ invoice: { id: string } }>(
    'POST',
    '/sales/checkout',
    ctx.token,
    checkoutBody(ctx.branch.id, ctx.walkIn.id, [line(item.id, { rate: 99.5 })], [{ mode: 'CASH', amount: 99.5 }])
  );
  return { admin, ctx, item, saleId: sale.invoice.id };
}

describe('local backups', () => {
  let backupFile: string;
  let saleId: string;
  let counts: Record<string, number>;

  it('backs up every table and upload in one zip', async () => {
    ({ saleId } = await makeSale());
    mkdirSync(join(env.uploadsDir, 'items'), { recursive: true });
    writeFileSync(join(env.uploadsDir, 'items', 'before.png'), 'kept');

    backupFile = await createBackup({ prisma: t.db, dir: backupDir, uploadsDir: env.uploadsDir, reason: 'manual', appVersion: '9.9.9' });
    expect(backupFile).toMatch(/pos-backup-\d{4}-\d{2}-\d{2}-\d{6}-manual\.zip$/);
    expect(readdirSync(backupDir).filter((f) => f.endsWith('.partial'))).toEqual([]);

    const [listed] = await listBackups(backupDir);
    expect(listed).toMatchObject({ reason: 'manual', file: backupFile.split('/').pop() });
    counts = {
      SaleInvoice: await t.db.saleInvoice.count(),
      Item: await t.db.item.count(),
      User: await t.db.user.count(),
      StockLedger: await t.db.stockLedger.count()
    };
  });

  it('refuses a damaged file and leaves the data alone', async () => {
    const damaged = join(backupDir, 'damaged.zip');
    const bytes = readFileSync(backupFile);
    writeFileSync(damaged, bytes.subarray(0, Math.floor(bytes.length / 2)));
    await expect(
      restoreBackup({ file: damaged, databaseUrl: env.databaseUrl, uploadsDir: env.uploadsDir, apiRoot })
    ).rejects.toThrow();
    expect(await t.db.saleInvoice.count()).toBe(counts.SaleInvoice);
    const leftovers = await t.db.$queryRaw<Array<{ datname: string }>>`SELECT datname FROM pg_database WHERE datname LIKE 'pos_backup_test_%'`;
    expect(leftovers).toEqual([]);
  });

  it('restores the business exactly as it was, uploads included', async () => {
    // Changes made after the backup, which the restore must undo.
    const admin = await t.login();
    await t.ok('POST', '/items', admin, { code: `LATE${randomUUID().slice(0, 6)}`, name: 'Added later', uom: 'PCS', sellPrice: 5, taxRate: 0, taxMode: 'EXCLUSIVE' });
    writeFileSync(join(env.uploadsDir, 'items', 'after.png'), 'gone after restore');
    const grandTotal = (await t.db.saleInvoice.findUniqueOrThrow({ where: { id: saleId } })).grandTotal.toString();
    await t.close();

    const logs: string[] = [];
    const manifest = await restoreBackup({
      file: backupFile,
      databaseUrl: env.databaseUrl,
      uploadsDir: env.uploadsDir,
      apiRoot,
      log: (m) => logs.push(m)
    });
    expect(manifest.schemaVersion).toBe(migrations[migrations.length - 1]);
    expect(logs.at(-1)).toBe('Restore finished');

    t = await startApp();
    expect(await t.db.item.count()).toBe(counts.Item);
    expect(await t.db.item.count({ where: { name: 'Added later' } })).toBe(0);
    expect(await t.db.saleInvoice.count()).toBe(counts.SaleInvoice);
    expect(await t.db.stockLedger.count()).toBe(counts.StockLedger);
    expect(await t.db.user.count()).toBe(counts.User);
    // Money comes back to the paisa.
    expect((await t.db.saleInvoice.findUniqueOrThrow({ where: { id: saleId } })).grandTotal.toString()).toBe(grandTotal);
    // Staff sign in with the same passwords.
    expect(await t.login()).toEqual(expect.any(String));

    expect(readFileSync(join(env.uploadsDir, 'items', 'before.png'), 'utf8')).toBe('kept');
    expect(existsSync(join(env.uploadsDir, 'items', 'after.png'))).toBe(false);
  });

  it('restores a backup made before an update, then migrations bring it up to date', async () => {
    const olderVersion = migrations[migrations.length - 2];
    const oldUrl = databaseUrl('pos_backup_old_test');
    const admin = new PrismaClient({ datasourceUrl: databaseUrl('template1') });
    await admin.$executeRawUnsafe('DROP DATABASE IF EXISTS pos_backup_old_test WITH (FORCE)');
    await admin.$executeRawUnsafe('CREATE DATABASE pos_backup_old_test');
    await admin.$disconnect();
    await migrateDatabaseUpTo(oldUrl, apiRoot, olderVersion, await mkdtemp(join(tmpdir(), 'pos-old-')));

    const old = new PrismaClient({ datasourceUrl: oldUrl });
    await old.$executeRawUnsafe(`INSERT INTO "Branch" ("id", "name", "code") VALUES ('${randomUUID()}', 'Old Branch', 'OLD')`);
    const oldBackupDir = await mkdtemp(join(tmpdir(), 'pos-old-backups-'));
    const oldUploads = await mkdtemp(join(tmpdir(), 'pos-old-uploads-'));
    const file = await createBackup({ prisma: old, dir: oldBackupDir, uploadsDir: oldUploads, reason: 'before-update', appVersion: '0.0.9' });
    await old.$disconnect();

    await t.close();
    const manifest = await restoreBackup({ file, databaseUrl: env.databaseUrl, uploadsDir: env.uploadsDir, apiRoot });
    expect(manifest.schemaVersion).toBe(olderVersion);
    // What the desktop app does on its next start.
    execSync('npx prisma migrate deploy', { cwd: apiRoot, env: { ...process.env, DATABASE_URL: env.databaseUrl }, stdio: 'pipe' });

    const db = new PrismaClient({ datasourceUrl: env.databaseUrl });
    expect(await db.branch.findMany({ select: { code: true } })).toEqual([{ code: 'OLD' }]);
    const [latest] = await db.$queryRaw<Array<{ name: string }>>`SELECT migration_name AS name FROM "_prisma_migrations" ORDER BY migration_name DESC LIMIT 1`;
    expect(latest.name).toBe(migrations[migrations.length - 1]);
    await db.$disconnect();

    // Put the usual seed back for afterAll's checks.
    resetDatabase(env.databaseUrl);
    t = await startApp();
  });

  it('refuses a backup made by a newer version of the app', async () => {
    const manifest = { schemaVersion: '99999999999999_from_the_future', appVersion: '9.0.0' } as BackupManifest;
    await expect(assertRestorable(manifest, join(apiRoot, 'prisma', 'migrations'))).rejects.toThrow(/newer version of the app \(9\.0\.0\)/);
  });
});

describe('backup retention', () => {
  it('keeps the last N days (2 to 5) and always the newest backup', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pos-prune-'));
    const at = (day: number, hour = 10) => new Date(2026, 9, day, hour, 0, 0);
    for (const day of [1, 2, 3, 4, 5]) await writeFile(join(dir, backupFileName('daily', at(day))), '');
    await writeFile(join(dir, backupFileName('before-update', at(4, 12))), '');
    await writeFile(join(dir, 'notes.txt'), 'not a backup');

    const removed = await pruneBackups(dir, 3, at(5, 18));
    expect(removed.sort()).toEqual([backupFileName('daily', at(1)), backupFileName('daily', at(2))].sort());
    expect((await listBackups(dir)).map((b) => b.date)).toEqual(['2026-10-05', '2026-10-04', '2026-10-04', '2026-10-03']);
    expect(readdirSync(dir)).toContain('notes.txt');

    // A computer switched off for weeks still keeps its last backup.
    expect(await pruneBackups(dir, 2, at(30))).toHaveLength(3);
    expect((await listBackups(dir)).map((b) => b.date)).toEqual(['2026-10-05']);
  });

  it('limits the setting to 2 to 5 days', () => {
    expect([clampBackupDays(1), clampBackupDays(3), clampBackupDays(9), clampBackupDays('x')]).toEqual([2, 3, 5, 3]);
  });
});
