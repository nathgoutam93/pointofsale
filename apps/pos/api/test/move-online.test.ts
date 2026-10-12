import archiver from 'archiver';
import { randomUUID } from 'crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { mkdtemp } from 'fs/promises';
import { once } from 'events';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { MIGRATION_TABLES } from '@pos/contracts';
import { extractZip } from '../src/common/zip';
import { uploadsDir } from '../src/common/uploads';
import { ExportService } from '../src/migration/export.service';
import { schemaUrl } from '../src/tenancy/database-urls';
import { TenancyService } from '../src/tenancy/tenancy.service';
import { ADMIN, startApp, type TestApp } from './helpers';

// Moving an offline business online, server side: the export a desktop app uploads becomes a
// new business. The export here comes from the test business through the same ExportService
// the desktop app's local API runs.
let t: TestApp;
let bundle: string;
let ownerToken: string;
const owner = { email: `mover-${randomUUID().slice(0, 8)}@example.com`, password: 'owner-pass-1' };
const delegate = (db: PrismaClient, table: string) =>
  (db as unknown as Record<string, { count(): Promise<number> }>)[table[0].toLowerCase() + table.slice(1)];

beforeAll(async () => {
  t = await startApp();
  // Something to sell, with an image, so money, stock and uploads all travel.
  const admin = await t.login();
  const ctx = await t.branchWithRegister(admin);
  const item = await t.item(ctx.token, ctx.branch.id, { sellPrice: 99.5, stock: 5 });
  mkdirSync(join(uploadsDir, 'items'), { recursive: true });
  writeFileSync(join(uploadsDir, 'items', 'move-online-fixture.png'), 'fixture image');
  await t.db.item.update({ where: { id: item.id }, data: { imageUrl: '/uploads/items/move-online-fixture.png' } });
  await t.ok('POST', '/registers/close', ctx.token, { closingBalance: 0 });

  const dir = await mkdtemp(join(tmpdir(), 'pos-move-'));
  bundle = join(dir, 'bundle.zip');
  const exporter = t.app.get(ExportService);
  await t.inBusiness(async () => {
    const prepared = await exporter.prepare();
    const out = createWriteStream(bundle);
    await exporter.stream(prepared, out);
  });
});
afterAll(async () => {
  await t.close();
});

async function upload(file: string, token: string | null, importId: string = randomUUID()) {
  const form = new FormData();
  form.set('importId', importId);
  form.set('bundle', new Blob([readFileSync(file)]), 'bundle.zip');
  const res = await fetch(`${t.baseUrl}/businesses/import`, {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: form
  });
  return { status: res.status, body: await res.json() };
}

/** A copy of the bundle with its manifest changed. */
async function withManifest(change: (manifest: Record<string, unknown>) => void) {
  const dir = await mkdtemp(join(tmpdir(), 'pos-move-edit-'));
  await extractZip(bundle, dir, 1e9);
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  change(manifest);
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  const target = join(dir, 'edited.zip');
  const archive = archiver('zip');
  const out = createWriteStream(target);
  archive.pipe(out);
  archive.directory(dir, false, (entry) => (entry.name === 'edited.zip' ? false : entry));
  await archive.finalize();
  await once(out, 'close');
  return target;
}

describe('moving a business online', () => {
  it('gives the owner an account to move with', async () => {
    const res = await t.ok('POST', '/accounts/signup', null, owner);
    expect(res).toMatchObject({ token: expect.any(String), businesses: [] });
    ownerToken = res.token;
    // Signing up again is signing in, with the same password only.
    expect((await t.call('POST', '/accounts/signup', null, { ...owner, password: 'another-pass' })).status).toBe(400);
  });

  it('needs an owner token', async () => {
    expect((await upload(bundle, null)).status).toBe(401);
    expect((await upload(bundle, await t.login())).status).toBe(401);
  });

  it('refuses exports from another app version or with damaged files', async () => {
    const older = await withManifest((m) => (m.schemaVersion = '20200101000000_older'));
    expect((await upload(older, ownerToken)).body.message).toMatch(/older than the server\. Update the app/);
    const damaged = await withManifest((m) => ((m.tables as Array<{ sha256: string }>)[3].sha256 = 'f'.repeat(64)));
    expect((await upload(damaged, ownerToken)).body.message).toMatch(/damaged/);
    const notABundle = join(await mkdtemp(join(tmpdir(), 'pos-move-bad-')), 'x.zip');
    writeFileSync(notABundle, 'not a zip');
    expect((await upload(notABundle, ownerToken)).status).toBe(400);
  });

  it('creates the business with every row, image and password, under a new code', async () => {
    const importId = randomUUID();
    const res = await upload(bundle, ownerToken, importId);
    expect(res.status).toBe(201);
    const { id, code, name } = res.body.business;
    expect(name).toBe('Main Branch');

    const moved = await t.app.get(TenancyService).control.business.findUniqueOrThrow({ where: { id } });
    const target = new PrismaClient({ datasourceUrl: schemaUrl(moved.schemaName) });
    try {
      for (const table of MIGRATION_TABLES) {
        expect(await delegate(target, table).count(), table).toBe(await delegate(t.db, table).count());
      }
      const item = await target.item.findFirstOrThrow({ where: { imageUrl: { contains: 'move-online-fixture' } } });
      expect(item.imageUrl).toBe(`/uploads/imported/${id}/items/move-online-fixture.png`);
      const original = await t.db.item.findUniqueOrThrow({ where: { id: item.id } });
      expect(item.sellPrice.toString()).toBe(original.sellPrice.toString());
    } finally {
      await target.$disconnect();
    }
    const image = await fetch(`${t.baseUrl}/uploads/imported/${id}/items/move-online-fixture.png`);
    expect(await image.text()).toBe('fixture image');

    // Staff keep their usernames and passwords; only the business code is new.
    const session = await t.ok('POST', '/auth/login', null, { businessCode: code, username: ADMIN.username, password: ADMIN.password });
    expect((await t.ok('GET', '/business/settings', session.token)).name).toBe('Main Branch');
    expect((await t.ok('GET', '/accounts/businesses', ownerToken)).map((b: { code: string }) => b.code)).toContain(code);

    // The desktop app retries after a lost answer: same business, not a second one.
    const again = await upload(bundle, ownerToken, importId);
    expect(again.body.business.id).toBe(id);
    // Another owner can't claim it.
    const other = await t.ok('POST', '/accounts/signup', null, { email: `x-${randomUUID().slice(0, 6)}@example.com`, password: 'other-pass-1' });
    expect((await upload(bundle, other.token, importId)).status).toBe(409);
    expect(existsSync(join(uploadsDir, 'imported', id, 'items', 'move-online-fixture.png'))).toBe(true);
  });
});
