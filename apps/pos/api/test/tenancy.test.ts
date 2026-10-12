import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { signToken } from '../src/auth/token';
import { PrismaService } from '../src/prisma.service';
import { schemaUrl } from '../src/tenancy/database-urls';
import { migrateAllBusinesses } from '../src/tenancy/migrate-all';
import { latestBusinessMigration } from '../src/tenancy/migrator';
import { TenancyService } from '../src/tenancy/tenancy.service';
import { startApp, type TestApp } from './helpers';

// The hosted server: many businesses, one PostgreSQL schema each.
let t: TestApp;
beforeAll(async () => {
  t = await startApp();
});
afterAll(async () => {
  await t.close();
});

const control = () => t.app.get(TenancyService).control;

/** A new business through sign-up, as the desktop app's "create a business" does. */
async function signUp(name: string, ownerEmail = `owner-${randomUUID().slice(0, 8)}@example.com`, ownerPassword = 'owner-pass-1') {
  const res = await t.call('POST', '/businesses', null, {
    ownerEmail,
    ownerPassword,
    businessName: name,
    adminUsername: 'admin',
    adminPassword: 'shop-admin-1'
  });
  return { ...res, ownerEmail, ownerPassword };
}

const loginTo = (businessCode: string | undefined, username = 'admin', password = 'shop-admin-1') =>
  t.call('POST', '/auth/login', null, { businessCode, username, password });

describe('businesses on the hosted server', () => {
  let a: { code: string; id: string; token: string; ownerEmail: string };
  let b: { code: string; id: string; token: string };

  it('creates a business with its own code, schema and admin, and signs the admin in', async () => {
    const res = await signUp('Asha Stores');
    expect(res.status).toBe(201);
    expect(res.body.business).toMatchObject({ name: 'Asha Stores', status: 'ACTIVE', code: expect.stringMatching(/^[A-Z2-9]{6}$/) });
    a = { code: res.body.business.code, id: res.body.business.id, token: res.body.session.token, ownerEmail: res.ownerEmail };

    const me = await t.ok('GET', '/auth/me', a.token);
    expect(me).toMatchObject({ username: 'admin', role: 'ADMIN' });
    expect((await t.ok('GET', '/business/settings', a.token)).name).toBe('Asha Stores');

    const row = await control().business.findUniqueOrThrow({ where: { id: a.id } });
    expect(row).toMatchObject({ status: 'ACTIVE', schemaVersion: latestBusinessMigration(), schemaName: expect.stringMatching(/^b_[0-9a-f]{32}$/) });
    // The same owner can create a second business with the same password.
    const second = await signUp('Asha Stores 2', a.ownerEmail);
    expect(second.status).toBe(201);
    b = { code: second.body.business.code, id: second.body.business.id, token: second.body.session.token };
  });

  it('builds every business schema exactly as the data model describes', async () => {
    // Migrations run once per business. One that looks at other schemas (or "public") would
    // leave later businesses different from the first; compare a later one with the model.
    const schemaName = (await control().business.findUniqueOrThrow({ where: { id: b.id } })).schemaName;
    const diff = execSync(
      `npx prisma migrate diff --from-url "${schemaUrl(schemaName)}" --to-schema-datamodel prisma/schema.prisma --script`,
      { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8' }
    );
    expect(diff.trim()).toBe('-- This is an empty migration.');
  });

  it('keeps each business to its own data, even with the same usernames', async () => {
    const tokenA = (await loginTo(a.code)).body.token;
    const tokenB = (await loginTo(b.code)).body.token;
    expect(tokenA).toEqual(expect.any(String));
    expect(tokenB).toEqual(expect.any(String));

    await t.ok('POST', '/items', tokenA, { code: 'ONLY-A', name: 'Only in A', uom: 'PCS', sellPrice: 10, taxRate: 0, taxMode: 'EXCLUSIVE' });
    expect((await t.ok<Array<{ code: string }>>('GET', '/items', tokenA)).map((item) => item.code)).toContain('ONLY-A');
    expect((await t.ok<Array<{ code: string }>>('GET', '/items', tokenB)).map((item) => item.code)).not.toContain('ONLY-A');

    // A record of one business can't be reached with another's token.
    const [branchA] = await t.ok<Array<{ id: string }>>('GET', '/branches', tokenA);
    expect((await t.call('GET', `/branches/${branchA.id}`, tokenB)).status).toBe(404);
    expect((await t.call('GET', `/branches/${branchA.id}`, tokenA)).status).toBe(200);

    // And the data really is in separate schemas.
    const schemaA = (await control().business.findUniqueOrThrow({ where: { id: a.id } })).schemaName;
    const direct = new PrismaClient({ datasourceUrl: schemaUrl(schemaA) });
    expect(await direct.item.count({ where: { code: 'ONLY-A' } })).toBe(1);
    await direct.$disconnect();
  });

  it('runs business-wide locks and raw queries in the business schema', async () => {
    const business = await control().business.findUniqueOrThrow({ where: { id: a.id } });
    const prisma = t.app.get(PrismaService);
    const [{ schema }] = await t.app
      .get(TenancyService)
      .run(business, () => prisma.$queryRaw<Array<{ schema: string }>>`SELECT current_schema() AS schema`);
    expect(schema).toBe(business.schemaName);
    // Without a business, nothing reaches any data.
    expect(() => prisma.item).toThrow(/No business chosen/);
  });

  it('needs a known business code to sign in', async () => {
    expect((await loginTo(undefined)).body.message).toBe('Enter your business code');
    expect((await loginTo('NOSUCH')).body.message).toBe('Unknown business code');
    expect((await loginTo(a.code.toLowerCase())).status).toBe(200);
    expect((await loginTo(a.code, 'admin', 'wrong-password')).status).toBe(400);
  });

  it('refuses a token that names no business', async () => {
    const user = await new PrismaClient({ datasourceUrl: schemaUrl((await control().business.findUniqueOrThrow({ where: { id: a.id } })).schemaName) })
      .user.findFirstOrThrow({ where: { username: 'admin' } });
    const noBusiness = signToken({ userId: user.id, role: 'ADMIN' });
    expect((await t.call('GET', '/auth/me', noBusiness)).status).toBe(401);
  });

  it('locks out repeated wrong passwords for a while', async () => {
    const res = await signUp('Lockout Test');
    const code = res.body.business.code;
    for (let i = 0; i < 10; i += 1) expect((await loginTo(code, 'admin', 'wrong-password')).status).toBe(400);
    expect((await loginTo(code)).status).toBe(429);
    // Another user of the same business isn't affected.
    expect((await loginTo(code, 'someone-else', 'x')).status).toBe(400);
  });

  it('turns away a suspended business, including sessions already open', async () => {
    const res = await signUp('Suspended Shop');
    const { id, code } = res.body.business;
    const token = res.body.session.token;
    expect((await t.call('GET', '/auth/me', token)).status).toBe(200);
    await control().business.update({ where: { id }, data: { status: 'SUSPENDED' } });
    t.app.get(TenancyService).forget(id);
    expect((await t.call('GET', '/auth/me', token)).status).toBe(401);
    expect((await loginTo(code)).body.message).toBe('This business is not active');
  });

  it('gives owners their own sign-in, separate from staff', async () => {
    const wrong = await signUp('Someone Else', a.ownerEmail, 'not-the-password');
    expect(wrong.status).toBe(400);
    expect(wrong.body.message).toMatch(/already has an account/);
    expect(await control().business.count({ where: { name: 'Someone Else' } })).toBe(0);

    expect((await t.call('POST', '/accounts/login', null, { email: a.ownerEmail, password: 'nope-nope' })).status).toBe(400);
    const owner = await t.ok('POST', '/accounts/login', null, { email: a.ownerEmail.toUpperCase(), password: 'owner-pass-1' });
    expect(owner.businesses.map((business: { code: string }) => business.code)).toEqual([a.code, b.code]);
    expect(await t.ok('GET', '/accounts/businesses', owner.token)).toHaveLength(2);

    // Owner and staff tokens can't stand in for each other.
    expect((await t.call('GET', '/accounts/businesses', a.token)).status).toBe(401);
    expect((await t.call('GET', '/auth/me', owner.token)).status).toBe(401);
  });

  it('brings every business up to the latest migration at deploy', async () => {
    await control().business.updateMany({ data: { schemaVersion: null } });
    const lines: string[] = [];
    const result = await migrateAllBusinesses({ concurrency: 2, log: (line) => lines.push(line) });
    expect(result.ok).toBe(true);
    expect(lines[0]).toBe('Control schema is up to date');
    const live = await control().business.findMany({ where: { status: { in: ['ACTIVE', 'SUSPENDED'] } } });
    expect(result.results).toHaveLength(live.length);
    expect(live.every((business) => business.schemaVersion === latestBusinessMigration())).toBe(true);
  });
});
