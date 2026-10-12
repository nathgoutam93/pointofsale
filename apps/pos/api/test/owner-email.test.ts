import { randomUUID } from 'crypto';
import { createServer, type AddressInfo } from 'net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EMAIL_VERIFICATION_REQUIRED } from '@pos/contracts';
import { mailOutbox } from '../src/mail/mailer';
import { TenancyService } from '../src/tenancy/tenancy.service';
import { startApp, type TestApp } from './helpers';

// Owners prove their email address before it creates a business, and hear about what matters.
let t: TestApp;
beforeAll(async () => {
  process.env.MAIL_TRANSPORT = 'memory';
  process.env.OWNER_EMAIL_VERIFICATION = 'on';
  t = await startApp();
});
afterAll(async () => {
  process.env.OWNER_EMAIL_VERIFICATION = 'off';
  delete process.env.MAIL_TRANSPORT;
  await t.close();
});
beforeEach(() => {
  mailOutbox.length = 0;
});

const control = () => t.app.get(TenancyService).control;
const codeIn = (text: string) => text.match(/code is (\d{8})/)![1];
const otherCode = (code: string) => (code === '00000000' ? '11111111' : '00000000');

function create(ownerEmail: string, extra: Record<string, unknown> = {}) {
  return t.call('POST', '/businesses', null, {
    ownerEmail,
    ownerPassword: 'owner-pass-1',
    businessName: 'Verified Stores',
    adminUsername: 'admin',
    adminPassword: 'shop-admin-1',
    ...extra
  });
}

describe('owner email verification', () => {
  it('emails a code before a new address creates a business, then creates it with the code', async () => {
    const email = `new-${randomUUID().slice(0, 8)}@example.com`;
    const first = await create(email);
    expect(first.status).toBe(400);
    expect(first.body.code).toBe(EMAIL_VERIFICATION_REQUIRED);
    expect(first.body.message).toContain(email);
    // No account until the code is used.
    expect(await control().account.findUnique({ where: { email } })).toBeNull();
    expect(mailOutbox).toHaveLength(1);
    const code = codeIn(mailOutbox[0].text);

    expect((await create(email, { emailCode: otherCode(code) })).status).toBe(400);
    mailOutbox.length = 0;
    const created = await create(email, { emailCode: code });
    expect(created.status).toBe(201);
    const account = await control().account.findUniqueOrThrow({ where: { email } });
    expect(account.emailVerifiedAt).not.toBeNull();

    // The owner is sent the business code.
    expect(mailOutbox.map((mail) => mail.subject)).toEqual([`Verified Stores is online. Business code: ${created.body.business.code}`]);
    expect(mailOutbox[0].text).toContain(`Business code: ${created.body.business.code}`);

    // Verified once: the next business needs no code; a spent code doesn't work again anyway.
    mailOutbox.length = 0;
    const second = await create(email, { businessName: 'Verified Stores 2' });
    expect(second.status).toBe(201);
    expect(mailOutbox.some((mail) => /verification code/.test(mail.subject))).toBe(false);
  });

  it('asks an existing, unverified owner once (after their password), as when moving online', async () => {
    const email = `old-${randomUUID().slice(0, 8)}@example.com`;
    const { hashPassword } = await import('../src/auth/password');
    await control().account.create({ data: { email, passwordHash: await hashPassword('owner-pass-1') } });

    // A wrong password gets no code.
    expect((await t.call('POST', '/accounts/signup', null, { email, password: 'wrong-pass-1' })).status).toBe(400);
    expect(mailOutbox).toHaveLength(0);

    const asked = await t.call('POST', '/accounts/signup', null, { email, password: 'owner-pass-1' });
    expect(asked.body.code).toBe(EMAIL_VERIFICATION_REQUIRED);
    const code = codeIn(mailOutbox[0].text);
    const signedIn = await t.call('POST', '/accounts/signup', null, { email, password: 'owner-pass-1', emailCode: code });
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.token).toMatch(/\./);
    expect((await t.call('POST', '/accounts/signup', null, { email, password: 'owner-pass-1' })).status).toBe(200);
  });

  it('refuses a code after too many wrong tries, or once expired', async () => {
    const email = `tries-${randomUUID().slice(0, 8)}@example.com`;
    await create(email);
    const code = codeIn(mailOutbox[0].text);
    for (let i = 0; i < 5; i += 1) await create(email, { emailCode: otherCode(code) });
    expect((await create(email, { emailCode: code })).status).toBe(400);

    const late = `late-${randomUUID().slice(0, 8)}@example.com`;
    mailOutbox.length = 0;
    await create(late);
    const lateCode = codeIn(mailOutbox[0].text);
    await control().emailVerification.updateMany({ where: { email: late }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await create(late, { emailCode: lateCode })).status).toBe(400);
  });

  it('tells the owner when their password changes', async () => {
    const email = `notice-${randomUUID().slice(0, 8)}@example.com`;
    process.env.OWNER_EMAIL_VERIFICATION = 'off';
    try {
      expect((await create(email)).status).toBe(201);
    } finally {
      process.env.OWNER_EMAIL_VERIFICATION = 'on';
    }
    mailOutbox.length = 0;
    await t.call('POST', '/accounts/password-reset', null, { email });
    const code = codeIn(mailOutbox[0].text);
    expect((await t.call('POST', '/accounts/password-reset/confirm', null, { email, code, newPassword: 'changed-pass-1' })).status).toBe(200);
    expect(mailOutbox.at(-1)!.subject).toBe('Your Point of Sale owner password was changed');
  });
});

describe('when the mail server refuses', () => {
  it('says the email could not be sent (503), not an internal error', async () => {
    // A mail server that turns every login away, as one does with a wrong SMTP_URL password.
    const server = createServer((socket) => {
      socket.write('220 test ESMTP\r\n');
      socket.on('data', (data) => {
        for (const line of data.toString().split('\r\n').filter(Boolean)) {
          if (/^EHLO/i.test(line)) socket.write('250-test\r\n250 AUTH PLAIN LOGIN\r\n');
          else if (/^AUTH/i.test(line)) socket.write('535 5.7.8 Authentication failed\r\n');
          else if (/^QUIT/i.test(line)) socket.end('221 bye\r\n');
          else socket.write('250 ok\r\n');
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    delete process.env.MAIL_TRANSPORT;
    process.env.SMTP_URL = `smtp://user:wrong@127.0.0.1:${port}`;
    try {
      const res = await create(`refused-${randomUUID()}@example.com`);
      expect(res.status).toBe(503);
      expect(res.body.message).toMatch(/Couldn't send the email/);
    } finally {
      process.env.MAIL_TRANSPORT = 'memory';
      delete process.env.SMTP_URL;
      server.close();
    }
  });
});
