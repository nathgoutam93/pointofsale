import { execSync } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import { writeFileSync } from 'fs';
import { request } from 'http';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import yauzl from 'yauzl';
import { APP_VERSION, MIGRATION_TABLES, migrationManifestSchema } from '@pos/contracts';
import { startApp, type TestApp } from './helpers';

// An offline (desktop) install: its own empty database, so first-run setup can be tested.
// Runs before the imports above are evaluated, because some settings are read as modules load.
const env = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('fs');
  const { tmpdir } = await import('os');
  const { join } = await import('path');
  const base = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/pos_test?schema=public';
  const url = new URL(base);
  url.pathname = '/pos_offline_test';
  process.env.DATABASE_URL = url.toString();
  process.env.POS_MODE = 'offline';
  // A fresh folder each run, so the bundle holds only this test's uploads.
  process.env.UPLOADS_DIR = mkdtempSync(join(tmpdir(), 'pos-offline-uploads-'));
  return { databaseUrl: url.toString(), uploadsDir: process.env.UPLOADS_DIR };
});

const SETUP = {
  businessName: 'Corner Store',
  gstNumber: '29ABCDE1234F1ZW',
  timezone: 'Asia/Kolkata',
  branchCode: 'cst',
  adminUsername: 'owner',
  adminPassword: 'owner-pass-1'
};

let t: TestApp;

beforeAll(async () => {
  execSync('npx prisma migrate reset --force --skip-seed --skip-generate', {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, DATABASE_URL: env.databaseUrl },
    stdio: 'pipe'
  });
  t = await startApp();
});
afterAll(async () => {
  await t.close();
});

/** Every file in a zip, by name. */
function unzip(buffer: Buffer) {
  return new Promise<Map<string, Buffer>>((resolve, reject) => {
    const files = new Map<string, Buffer>();
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error);
      zip.on('entry', (entry: yauzl.Entry) => {
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) return reject(streamError);
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('end', () => {
            files.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => resolve(files));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

async function download(path: string, token: string) {
  const res = await fetch(t.baseUrl + path, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, headers: res.headers, body: Buffer.from(await res.arrayBuffer()) };
}

/** A raw request, so the Host and Origin headers can be set. */
function rawRequest(method: string, path: string, headers: Record<string, string>) {
  const { hostname, port } = new URL(t.baseUrl);
  return new Promise<{ status: number; headers: Record<string, unknown> }>((resolve, reject) => {
    const req = request({ hostname, port, path, method, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

const setInstanceStatus = (status: 'ACTIVE' | 'MIGRATING' | 'ARCHIVED') =>
  t.db.localInstance.upsert({ where: { id: 'local' }, update: { status }, create: { id: 'local', status } });

describe('offline install', () => {
  it('starts empty and reports that setup is needed', async () => {
    expect(await t.db.user.count()).toBe(0);
    expect(await t.db.branch.count()).toBe(0);
    const meta = await t.ok('GET', '/meta');
    expect(meta).toEqual({
      appVersion: APP_VERSION,
      schemaVersion: expect.stringMatching(/^\d{14}_/),
      mode: 'offline',
      hosting: null,
      minClientVersion: null,
      setupRequired: true,
      instanceStatus: 'ACTIVE',
      movedTo: null
    });
  });

  it('only answers requests addressed to this machine, and only from allowed web origins', async () => {
    expect((await rawRequest('GET', '/meta', { host: 'evil.example' })).status).toBe(403);
    expect((await rawRequest('GET', '/meta', { host: `localhost:${new URL(t.baseUrl).port}` })).status).toBe(200);

    const preflight = (origin: string) =>
      rawRequest('OPTIONS', '/setup', {
        origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type'
      });
    expect((await preflight('https://evil.example')).headers['access-control-allow-origin']).toBeUndefined();
    expect((await preflight('http://localhost:3000')).headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('validates the setup form', async () => {
    const res = await t.call('POST', '/setup', null, { ...SETUP, adminPassword: 'short', stateCode: '27' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/adminPassword/);
    expect(JSON.stringify(res.body)).toMatch(/doesn't match the GSTIN/);
    expect(await t.db.user.count()).toBe(0);
  });

  it('creates the business, its branch, counter and admin once, even when called twice at the same time', async () => {
    const [first, second] = await Promise.all([
      t.call('POST', '/setup', null, SETUP),
      t.call('POST', '/setup', null, { ...SETUP, businessName: 'Other Store' })
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    // Either request may win; only one business is ever created.
    const winner = first.status === 201 ? first : second;
    const winnerName = first.status === 201 ? SETUP.businessName : 'Other Store';
    expect(winner.body).toMatchObject({ role: 'ADMIN', branches: [{ code: 'CST', name: winnerName }] });
    expect(typeof winner.body.token).toBe('string');
    // Shown once, for resetting a forgotten admin password.
    expect(winner.body.recoveryCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    expect(await t.db.user.count()).toBe(1);
    const branch = await t.db.branch.findFirstOrThrow();
    expect(branch).toMatchObject({ code: 'CST', stateCode: '29' });
    expect(await t.db.counter.count()).toBe(1);
    expect(await t.db.customer.count({ where: { isWalkIn: true, branchId: branch.id } })).toBe(1);
    expect(await t.db.businessSettings.findUniqueOrThrow({ where: { id: 'default' } })).toMatchObject({
      name: winnerName,
      gstNumber: '29ABCDE1234F1ZW'
    });

    expect((await t.call('POST', '/setup', null, SETUP)).status).toBe(409);
    expect((await t.ok('GET', '/meta')).setupRequired).toBe(false);
    // The admin signs in with the password typed at setup; none was generated or printed.
    expect(await t.login(SETUP.adminUsername, SETUP.adminPassword)).toEqual(expect.any(String));
  });

  it('allows one branch and one counter, and no transfers', async () => {
    const admin = await t.login(SETUP.adminUsername, SETUP.adminPassword);
    const branch = await t.db.branch.findFirstOrThrow();

    const newBranch = await t.call('POST', '/branches', admin, { name: 'Second', code: 'SEC' });
    expect(newBranch.status).toBe(403);
    expect(newBranch.body.message).toMatch(/Move your business online/);

    expect((await t.call('POST', `/branches/${branch.id}/counters`, admin, { name: 'Counter 2' })).status).toBe(403);
    const transfer = await t.call('POST', '/stock-transfers', admin, {
      fromBranchId: branch.id,
      toBranchId: '00000000-0000-4000-8000-000000000000',
      lines: [{ itemId: '00000000-0000-4000-8000-000000000001', qty: 1 }]
    });
    expect(transfer.status).toBe(403);
    expect(await t.db.branch.count()).toBe(1);
    expect(await t.db.counter.count()).toBe(1);
  });

  it('exports every table and upload as a bundle, once no register is open', async () => {
    const admin = await t.login(SETUP.adminUsername, SETUP.adminPassword);
    const branch = await t.db.branch.findFirstOrThrow();
    const opened = await t.ok<{ token: string }>('POST', '/registers/open', admin, { branchId: branch.id, openingBalance: 500 });
    const walkIn = await t.ok<{ id: string }>('GET', `/customers/walk-in/${branch.id}`, opened.token);
    const item = await t.item(opened.token, branch.id, { sellPrice: 99.5, taxRate: 5, stock: 20 });
    await t.ok('POST', '/sales/checkout', opened.token, {
      branchId: branch.id,
      customerId: walkIn.id,
      lines: [{ itemId: item.id, qty: 2, rate: 99.5, taxRate: 5, taxMode: 'EXCLUSIVE' }],
      payments: [{ mode: 'CASH', amount: 208.95 }],
      idempotencyKey: randomUUID()
    });
    writeFileSync(join(env.uploadsDir, 'items', 'photo.png'), 'not really a png');

    const blocked = await t.call('GET', '/migration/export', opened.token);
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/Close the open register first: Counter 1 \(owner\)/);
    const closed = await t.ok<{ token: string }>('POST', '/registers/close', opened.token, { closingBalance: 708.95 });

    const res = await download('/migration/export', closed.token);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    const files = await unzip(res.body);
    const manifest = migrationManifestSchema.parse(JSON.parse(files.get('manifest.json')!.toString('utf8')));
    expect(manifest).toMatchObject({ appVersion: APP_VERSION, schemaVersion: (await t.ok('GET', '/meta')).schemaVersion });
    expect(manifest.tables.map((table) => table.name)).toEqual([...MIGRATION_TABLES]);

    for (const table of manifest.tables) {
      const content = files.get(table.file)!;
      expect(createHash('sha256').update(content).digest('hex')).toBe(table.sha256);
      const lines = content.toString('utf8').split('\n').filter(Boolean);
      expect(lines).toHaveLength(table.rows);
      const delegate = (t.db as unknown as Record<string, { count(): Promise<number> }>)[table.name[0].toLowerCase() + table.name.slice(1)];
      expect(table.rows, table.name).toBe(await delegate.count());
    }
    const rowsOf = (name: string) =>
      files.get(`tables/${name}.ndjson`)!.toString('utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
    expect(manifest.tables.find((table) => table.name === 'SaleInvoice')!.rows).toBe(1);
    // Money keeps its exact decimal value, as a string.
    expect(rowsOf('SaleInvoice')[0].grandTotal).toBe('208.95');
    // Password hashes move with the users, so staff keep their passwords online.
    expect(rowsOf('User')[0].password).toMatch(/^scrypt\$/);
    // This machine's own state stays behind.
    expect([...files.keys()].some((name) => name.includes('LocalInstance'))).toBe(false);

    const upload = manifest.uploads.find((entry) => entry.file === 'uploads/items/photo.png')!;
    expect(upload.bytes).toBe(16);
    expect(files.get('uploads/items/photo.png')!.toString('utf8')).toBe('not really a png');
  });

  it('lets only admins export', async () => {
    const admin = await t.login(SETUP.adminUsername, SETUP.adminPassword);
    const branch = await t.db.branch.findFirstOrThrow();
    await t.ok('POST', '/users', admin, { branchId: branch.id, username: 'till', password: 'till-pass-1' });
    const cashier = await t.login('till', 'till-pass-1');
    expect((await t.call('GET', '/migration/export', cashier)).status).toBe(400);
    expect((await t.call('GET', '/migration/export')).status).toBe(401);
  });

  it('pauses changes while moving online and becomes read-only once moved', async () => {
    const admin = await t.login(SETUP.adminUsername, SETUP.adminPassword);
    const branch = await t.db.branch.findFirstOrThrow();
    try {
      await setInstanceStatus('MIGRATING');
      const paused = await t.call('PATCH', '/business/settings', admin, { name: 'Renamed' });
      expect(paused.status).toBe(423);
      expect(paused.body.message).toMatch(/being moved online/);
      // The export is how the move reads the data, so it still works.
      expect((await download('/migration/export', admin)).status).toBe(200);

      await setInstanceStatus('ARCHIVED');
      expect((await t.ok('GET', '/meta')).instanceStatus).toBe('ARCHIVED');
      const refused = await t.call('POST', '/registers/open', admin, { branchId: branch.id, openingBalance: 0 });
      expect(refused.status).toBe(423);
      expect(refused.body.message).toMatch(/moved online/);
      // Signing in and reading still work, so reports and GST history stay available.
      const again = await t.login(SETUP.adminUsername, SETUP.adminPassword);
      expect((await t.call('GET', '/business/settings', again)).status).toBe(200);
      expect((await t.call('GET', '/migration/export', again)).status).toBe(409);
    } finally {
      await setInstanceStatus('ACTIVE');
    }
    expect((await t.call('PATCH', '/business/settings', admin, { name: 'Corner Store' })).status).toBe(200);
  });
});

describe('moving online, on this computer', () => {
  it('pauses, can be cancelled, and once finished points to the online business', async () => {
    const admin = await t.login(SETUP.adminUsername, SETUP.adminPassword);
    const branch = await t.db.branch.findFirstOrThrow();
    const opened = await t.ok<{ token: string }>('POST', '/registers/open', admin, { branchId: branch.id, openingBalance: 0 });
    expect((await t.call('POST', '/migration/begin', opened.token)).status).toBe(409);
    const closed = await t.ok<{ token: string }>('POST', '/registers/close', opened.token, { closingBalance: 0 });

    expect((await t.call('POST', '/migration/complete', closed.token, { businessId: randomUUID(), businessCode: 'K7Q2MX', server: 'https://pos.example.com' })).status).toBe(409);
    expect(await t.ok('POST', '/migration/begin', closed.token)).toEqual({ status: 'MIGRATING' });
    expect((await t.call('PATCH', '/business/settings', closed.token, { name: 'Changed' })).status).toBe(423);
    expect(await t.ok('POST', '/migration/abort', closed.token)).toEqual({ status: 'ACTIVE' });
    expect((await t.call('PATCH', '/business/settings', closed.token, { name: SETUP.businessName })).status).toBe(200);

    await t.ok('POST', '/migration/begin', closed.token);
    const businessId = randomUUID();
    const done = { businessId, businessCode: 'K7Q2MX', server: 'https://pos.example.com' };
    expect(await t.ok('POST', '/migration/complete', closed.token, done)).toEqual({ status: 'ARCHIVED' });
    expect(await t.ok('POST', '/migration/complete', closed.token, done)).toEqual({ status: 'ARCHIVED' });
    expect(await t.ok('GET', '/meta')).toMatchObject({
      instanceStatus: 'ARCHIVED',
      movedTo: { businessCode: 'K7Q2MX', server: 'https://pos.example.com' }
    });
    expect((await t.call('POST', '/migration/abort', closed.token)).status).toBe(409);
    await t.db.localInstance.update({ where: { id: 'local' }, data: { status: 'ACTIVE', movedToBusinessCode: null, movedToServer: null } });
  });
});

describe('forgotten admin password', () => {
  it('resets an admin password with the recovery code, then replaces the code', async () => {
    let admin = await t.login(SETUP.adminUsername, SETUP.adminPassword);
    const branch = await t.db.branch.findFirstOrThrow();
    await t.call('POST', '/users', admin, { branchId: branch.id, username: 'till-2', password: 'till-pass-2' });
    const cashier = await t.login('till-2', 'till-pass-2');

    // Admins can see whether one exists and replace it; cashiers can't.
    expect((await t.ok('GET', '/auth/recovery-code', admin)).set).toBe(true);
    expect((await t.call('POST', '/auth/recovery-code', cashier)).status).toBe(400);
    const { recoveryCode } = await t.ok('POST', '/auth/recovery-code', admin);
    // The hash is never shown anywhere.
    expect(JSON.stringify(await t.ok('GET', '/business/settings', admin))).not.toMatch(/recovery/i);

    const recover = (body: Record<string, string>) => t.call('POST', '/auth/recover', null, body);
    const wrongCode = await recover({ recoveryCode: 'AAAA-BBBB-CCCC-DDDD', username: SETUP.adminUsername, newPassword: 'new-owner-pass' });
    const cashierName = await recover({ recoveryCode, username: 'till-2', newPassword: 'new-owner-pass' });
    expect([wrongCode.status, cashierName.status]).toEqual([400, 400]);
    expect(wrongCode.body.message).toBe(cashierName.body.message);

    // Typed loosely: lower case, spaces instead of dashes.
    const typed = recoveryCode.toLowerCase().replace(/-/g, ' ');
    const done = await t.ok('POST', '/auth/recover', null, { recoveryCode: typed, username: SETUP.adminUsername, newPassword: 'new-owner-pass' });
    expect(done.recoveryCode).not.toBe(recoveryCode);
    expect((await t.call('POST', '/auth/login', null, { username: SETUP.adminUsername, password: SETUP.adminPassword })).status).toBe(400);
    admin = await t.login(SETUP.adminUsername, 'new-owner-pass');
    // The old code is spent.
    expect((await recover({ recoveryCode, username: SETUP.adminUsername, newPassword: 'another-pass-1' })).status).toBe(400);

    // Put the password back for the tests after this one.
    await t.ok('POST', '/auth/recover', null, { recoveryCode: done.recoveryCode, username: SETUP.adminUsername, newPassword: SETUP.adminPassword });
  });

  it('stops repeated guessing', async () => {
    for (let i = 0; i < 5; i += 1) {
      expect((await t.call('POST', '/auth/recover', null, { recoveryCode: 'WRONG', username: 'owner', newPassword: 'whatever-1' })).status).toBe(400);
    }
    // Five wrong attempts from one address, then refused for a while.
    expect((await t.call('POST', '/auth/recover', null, { recoveryCode: 'WRONG', username: 'owner', newPassword: 'whatever-1' })).status).toBe(429);
  });
});

describe('offline listen address', () => {
  it('stays on this machine', async () => {
    const { listenAddress } = await import('../src/app-config');
    const previous = process.env.HOST;
    try {
      delete process.env.HOST;
      expect(listenAddress().host).toBe('127.0.0.1');
      process.env.HOST = '0.0.0.0';
      expect(() => listenAddress()).toThrow(/offline mode/);
    } finally {
      if (previous === undefined) delete process.env.HOST;
      else process.env.HOST = previous;
    }
  });
});
