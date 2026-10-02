import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isPasswordHash } from '../src/auth/password';
import { AuthService } from '../src/auth/auth.service';
import { startApp, type TestApp } from './helpers';

// #1: signed tokens, a guard that re-checks the database, hashed passwords.
let t: TestApp;
let admin: string;
let branchId: string;
beforeAll(async () => {
  t = await startApp();
  admin = await t.login();
  branchId = (await t.branchWithRegister(admin)).branch.id;
});
afterAll(async () => { await t.close(); });

const tamper = (token: string) => {
  const [payload, sig] = token.split('.');
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
  data.role = 'ADMIN';
  data.exp += 1e9;
  return `${Buffer.from(JSON.stringify(data)).toString('base64url')}.${sig}`;
};

async function cashier(name: string) {
  const username = `${name}-${Date.now()}`;
  const user = await t.ok('POST', '/users', admin, { branchId, username, password: 'cashier-pass-1' });
  return { user, token: await t.login(username, 'cashier-pass-1') };
}

describe('tokens', () => {
  it('rejects a wrong password, a missing token and the old unsigned format', async () => {
    expect((await t.call('POST', '/auth/login', null, { username: 'admin', password: 'nope' })).status).toBe(400);
    expect((await t.call('GET', '/auth/me')).status).toBe(401);
    expect((await t.call('GET', '/auth/me', Buffer.from('x:ADMIN').toString('base64'))).status).toBe(401);
  });

  it('rejects a token whose payload was edited', async () => {
    const { token } = await cashier('tamper');
    expect((await t.call('GET', '/auth/me', token)).status).toBe(200);
    expect((await t.call('GET', '/auth/me', tamper(token))).status).toBe(401);
  });

  it('rejects the token once the user is deactivated or their role changes', async () => {
    const a = await cashier('deactivate');
    await t.ok('PATCH', `/users/${a.user.id}`, admin, { isActive: false });
    expect((await t.call('GET', '/auth/me', a.token)).status).toBe(401);
    expect((await t.call('POST', '/auth/login', null, { username: a.user.username, password: 'cashier-pass-1' })).status).toBe(400);

    const b = await cashier('role');
    await t.db.user.update({ where: { id: b.user.id }, data: { role: 'ADMIN' } });
    expect((await t.call('GET', '/auth/me', b.token)).status).toBe(401);
  });

  it('rejects a register token after the register closes, and close returns a working token', async () => {
    const { token } = await t.branchWithRegister(admin);
    const closed = await t.ok('POST', '/registers/close', token, { closingBalance: 0 });
    expect((await t.call('GET', '/auth/me', token)).status).toBe(401);
    expect((await t.call('GET', '/auth/me', closed.token)).status).toBe(200);
  });
});

describe('passwords', () => {
  it('stores new passwords hashed and requires at least 8 characters', async () => {
    expect((await t.call('POST', '/users', admin, { branchId, username: `short-${Date.now()}`, password: 'short' })).status).toBe(400);
    const { user } = await cashier('hashed');
    const row = await t.db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(isPasswordHash(row.password)).toBe(true);
  });

  it('hashes plain-text passwords left from before, at startup, and they still log in', async () => {
    const username = `legacy-${Date.now()}`;
    await t.db.user.create({ data: { username, password: 'old-plain-pass', role: 'CASHIER', branchId } });
    await t.app.get(AuthService).onModuleInitSeed();
    const row = await t.db.user.findUniqueOrThrow({ where: { username } });
    expect(isPasswordHash(row.password)).toBe(true);
    expect((await t.call('POST', '/auth/login', null, { username, password: 'old-plain-pass' })).status).toBe(200);
  });
});
