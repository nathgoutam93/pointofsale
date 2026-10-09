import { randomUUID } from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PASSWORD_CHANGE_REQUIRED } from '@pos/contracts';
import { mailOutbox } from '../src/mail/mailer';
import { TenancyService } from '../src/tenancy/tenancy.service';
import { ADMIN, startApp, type TestApp } from './helpers';

// Password changes and resets on the hosted server: staff, and business owners.
let t: TestApp;
let admin: string;
let branchId: string;
beforeAll(async () => {
  process.env.MAIL_TRANSPORT = 'memory';
  t = await startApp();
  admin = await t.login();
  branchId = (await t.ok('GET', '/branches', admin))[0].id;
});
afterAll(async () => {
  delete process.env.MAIL_TRANSPORT;
  await t.close();
});

const loginAs = (username: string, password: string) =>
  t.call('POST', '/auth/login', null, { businessCode: t.businessCode, username, password });

async function cashier(password = 'cashier-pass-1') {
  const username = `pw-${randomUUID().slice(0, 8)}`;
  const user = await t.ok('POST', '/users', admin, { branchId, username, password });
  return { id: user.id as string, username, token: (await loginAs(username, password)).body.token as string };
}

describe('an admin resets a staff password', () => {
  it('signs the user out everywhere and makes them choose their own at next sign-in', async () => {
    const staff = await cashier();
    expect((await t.call('GET', '/auth/me', staff.token)).status).toBe(200);

    const updated = await t.ok('PATCH', `/users/${staff.id}`, admin, { password: 'temporary-1' });
    expect(updated.mustChangePassword).toBe(true);
    // The session from before the reset has ended, even within the same second.
    const old = await t.call('GET', '/auth/me', staff.token);
    expect(old.status).toBe(401);
    expect(old.body.message).toMatch(/password was changed/);

    const login = await loginAs(staff.username, 'temporary-1');
    expect(login.status).toBe(200);
    expect(login.body.mustChangePassword).toBe(true);
    const token = login.body.token;
    // Nothing but choosing a new password (and asking who they are) until they do.
    const blocked = await t.call('GET', '/branches', token);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe(PASSWORD_CHANGE_REQUIRED);
    expect((await t.call('GET', '/auth/me', token)).status).toBe(200);

    expect((await t.call('POST', '/auth/change-password', token, { currentPassword: 'wrong', newPassword: 'mine-now-1' })).status).toBe(400);
    expect((await t.call('POST', '/auth/change-password', token, { currentPassword: 'temporary-1', newPassword: 'temporary-1' })).status).toBe(400);
    const changed = await t.call('POST', '/auth/change-password', token, { currentPassword: 'temporary-1', newPassword: 'mine-now-1' });
    expect(changed.status).toBe(200);
    // The new token works right away; the one used to change it doesn't.
    expect((await t.call('GET', '/branches', changed.body.token)).status).toBe(200);
    expect((await t.call('GET', '/auth/me', token)).status).toBe(401);
    expect((await loginAs(staff.username, 'temporary-1')).status).toBe(400);
    const again = await loginAs(staff.username, 'mine-now-1');
    expect(again.body.mustChangePassword).toBe(false);
  });

  it('can set a password without asking for a new one', async () => {
    const staff = await cashier();
    const updated = await t.ok('PATCH', `/users/${staff.id}`, admin, { password: 'shared-pass-1', mustChangePassword: false });
    expect(updated.mustChangePassword).toBe(false);
    expect((await loginAs(staff.username, 'shared-pass-1')).body.mustChangePassword).toBe(false);
  });

  it('lets anyone change their own password', async () => {
    const staff = await cashier('first-pass-1');
    const res = await t.call('POST', '/auth/change-password', staff.token, { currentPassword: 'first-pass-1', newPassword: 'second-pass-1' });
    expect(res.status).toBe(200);
    expect((await loginAs(staff.username, 'second-pass-1')).status).toBe(200);
    expect((await t.call('POST', '/auth/change-password', staff.token, { currentPassword: 'second-pass-1', newPassword: 'third-pass-1' })).status).toBe(401);
  });
});

describe('owners', () => {
  const control = () => t.app.get(TenancyService).control;
  let owner: { email: string; password: string; businessId: string; code: string };

  beforeAll(async () => {
    const email = `owner-${randomUUID().slice(0, 8)}@example.com`;
    const res = await t.call('POST', '/businesses', null, {
      ownerEmail: email,
      ownerPassword: 'owner-pass-1',
      businessName: 'Reset Stores',
      adminUsername: 'admin',
      adminPassword: 'forgotten-1'
    });
    expect(res.status).toBe(201);
    owner = { email, password: 'owner-pass-1', businessId: res.body.business.id, code: res.body.business.code };
  });
  beforeEach(() => {
    mailOutbox.length = 0;
  });

  const ownerToken = async (password = owner.password) =>
    (await t.call('POST', '/accounts/login', null, { email: owner.email, password })).body.token as string;

  it("reset a forgotten admin password of their own business, and no one else's", async () => {
    const token = await ownerToken();
    const adminSession = (await t.call('POST', '/auth/login', null, { businessCode: owner.code, username: 'admin', password: 'forgotten-1' })).body.token;

    const res = await t.call('POST', '/accounts/staff-password', token, { businessId: owner.businessId, username: 'admin', newPassword: 'remembered-1' });
    expect(res.status).toBe(200);
    expect((await t.call('GET', '/auth/me', adminSession)).status).toBe(401);
    const login = await t.call('POST', '/auth/login', null, { businessCode: owner.code, username: 'admin', password: 'remembered-1' });
    expect(login.status).toBe(200);
    // The owner chose it; they aren't asked again.
    expect(login.body.mustChangePassword).toBe(false);

    // Another business (the shared test one), an unknown user, a staff token.
    const testBusinessId = (await control().business.findUniqueOrThrow({ where: { code: t.businessCode! } })).id;
    expect((await t.call('POST', '/accounts/staff-password', token, { businessId: testBusinessId, username: ADMIN.username, newPassword: 'taken-over-1' })).status).toBe(403);
    expect((await t.call('POST', '/accounts/staff-password', token, { businessId: owner.businessId, username: 'nobody', newPassword: 'whatever-1' })).status).toBe(400);
    expect((await t.call('POST', '/accounts/staff-password', login.body.token, { businessId: owner.businessId, username: 'admin', newPassword: 'whatever-1' })).status).toBe(401);
  });

  it('see their staff and turn them off and on, always keeping an active admin', async () => {
    const token = await ownerToken();
    const adminSession = (await t.call('POST', '/auth/login', null, { businessCode: owner.code, username: 'admin', password: 'remembered-1' })).body.token;
    const branchId = (await t.call('GET', '/branches', adminSession)).body[0].id;
    expect((await t.call('POST', '/users', adminSession, { branchId, username: 'till-1', password: 'cashier-pass-1' })).status).toBe(201);
    const cashierLogin = () => t.call('POST', '/auth/login', null, { businessCode: owner.code, username: 'till-1', password: 'cashier-pass-1' });
    const cashierSession = (await cashierLogin()).body.token;

    const staff = await t.call('GET', `/accounts/businesses/${owner.businessId}/staff`, token);
    expect(staff.status).toBe(200);
    expect(staff.body.map((user: { username: string; role: string; isActive: boolean; branchName: string }) => [user.username, user.role, user.isActive, user.branchName])).toEqual([
      ['admin', 'ADMIN', true, expect.any(String)],
      ['till-1', 'CASHIER', true, expect.any(String)]
    ]);

    // Off: signed out everywhere, and can't sign in.
    const off = await t.call('POST', '/accounts/staff-active', token, { businessId: owner.businessId, username: 'till-1', isActive: false });
    expect(off.body).toEqual({ username: 'till-1', isActive: false });
    expect((await t.call('GET', '/auth/me', cashierSession)).status).toBe(401);
    expect((await cashierLogin()).status).not.toBe(200);
    expect((await t.call('POST', '/accounts/staff-active', token, { businessId: owner.businessId, username: 'till-1', isActive: true })).status).toBe(200);
    expect((await cashierLogin()).status).toBe(200);

    // The only admin stays on; other businesses and staff tokens get nothing.
    const lastAdmin = await t.call('POST', '/accounts/staff-active', token, { businessId: owner.businessId, username: 'admin', isActive: false });
    expect(lastAdmin.status).toBe(400);
    expect(lastAdmin.body.message).toMatch(/only active admin/);
    const testBusinessId = (await control().business.findUniqueOrThrow({ where: { code: t.businessCode! } })).id;
    expect((await t.call('GET', `/accounts/businesses/${testBusinessId}/staff`, token)).status).toBe(403);
    expect((await t.call('POST', '/accounts/staff-active', token, { businessId: testBusinessId, username: ADMIN.username, isActive: false })).status).toBe(403);
    expect((await t.call('GET', `/accounts/businesses/${owner.businessId}/staff`, adminSession)).status).toBe(401);
  });

  it('reset their own password with a code sent by email', async () => {
    const oldToken = await ownerToken();
    expect((await t.call('POST', '/accounts/password-reset', null, { email: owner.email.toUpperCase() })).status).toBe(202);
    expect(mailOutbox).toHaveLength(1);
    expect(mailOutbox[0].to).toBe(owner.email);
    const code = mailOutbox[0].text.match(/code is (\d{8})/)![1];

    const confirm = (body: Record<string, unknown>) => t.call('POST', '/accounts/password-reset/confirm', null, { email: owner.email, ...body });
    const wrong = code === '00000000' ? '11111111' : '00000000';
    expect((await confirm({ code: wrong, newPassword: 'new-owner-1' })).status).toBe(400);
    expect((await confirm({ code, newPassword: 'new-owner-1' })).status).toBe(200);
    // Once only.
    expect((await confirm({ code, newPassword: 'again-owner-1' })).status).toBe(400);

    expect((await t.call('POST', '/accounts/login', null, { email: owner.email, password: owner.password })).status).toBe(400);
    const token = await ownerToken('new-owner-1');
    expect((await t.call('GET', '/accounts/businesses', token)).status).toBe(200);
    // Owner sessions from before the reset have ended.
    expect((await t.call('GET', '/accounts/businesses', oldToken)).status).toBe(401);
    // Reading the code proved the email is theirs.
    const account = await control().account.findUniqueOrThrow({ where: { email: owner.email } });
    expect(account.emailVerifiedAt).not.toBeNull();
    owner.password = 'new-owner-1';
  });

  it('answers the same for an unknown email, and the code stops working after a few wrong tries', async () => {
    expect((await t.call('POST', '/accounts/password-reset', null, { email: 'nobody-here@example.com' })).status).toBe(202);
    expect(mailOutbox).toHaveLength(0);

    await t.call('POST', '/accounts/password-reset', null, { email: owner.email });
    const code = mailOutbox[0].text.match(/code is (\d{8})/)![1];
    const wrong = code === '00000000' ? '11111111' : '00000000';
    for (let i = 0; i < 5; i += 1) {
      await t.call('POST', '/accounts/password-reset/confirm', null, { email: owner.email, code: wrong, newPassword: 'guessing-1' });
    }
    expect((await t.call('POST', '/accounts/password-reset/confirm', null, { email: owner.email, code, newPassword: 'too-late-1' })).status).toBe(400);
  });

  it('refuses a code once it has expired', async () => {
    await t.call('POST', '/accounts/password-reset', null, { email: owner.email });
    const code = mailOutbox[0].text.match(/code is (\d{8})/)![1];
    const account = await control().account.findUniqueOrThrow({ where: { email: owner.email } });
    await control().passwordReset.updateMany({ where: { accountId: account.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await t.call('POST', '/accounts/password-reset/confirm', null, { email: owner.email, code, newPassword: 'too-late-1' })).status).toBe(400);
  });

  it("says so when this server can't send email", async () => {
    delete process.env.MAIL_TRANSPORT;
    try {
      const res = await t.call('POST', '/accounts/password-reset', null, { email: 'someone-else@example.com' });
      expect(res.status).toBe(503);
      expect(res.body.message).toMatch(/Email isn't set up/);
    } finally {
      process.env.MAIL_TRANSPORT = 'memory';
    }
  });
});
