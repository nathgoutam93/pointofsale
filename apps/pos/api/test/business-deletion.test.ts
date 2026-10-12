import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BusinessDeletionService, DELETION_GRACE_DAYS } from '../src/accounts/business-deletion.service';
import { uploadsDir } from '../src/common/uploads';
import { mailOutbox } from '../src/mail/mailer';
import { TenancyService } from '../src/tenancy/tenancy.service';
import { startApp, type TestApp } from './helpers';

// An owner deletes one of their businesses with their password and a code emailed to them: it is
// locked at once, can be kept within the grace period, and is then erased with its files.
let t: TestApp;
beforeAll(async () => {
  process.env.MAIL_TRANSPORT = 'memory';
  t = await startApp();
});
afterAll(async () => {
  delete process.env.MAIL_TRANSPORT;
  await t.close();
});
beforeEach(() => {
  mailOutbox.length = 0;
});

const control = () => t.app.get(TenancyService).control;

async function newBusiness() {
  const email = `owner-${randomUUID().slice(0, 8)}@example.com`;
  const res = await t.call('POST', '/businesses', null, { ownerEmail: email, ownerPassword: 'owner-pass-1', businessName: 'Closing Down Stores', adminUsername: 'admin', adminPassword: 'admin-pass-1' });
  expect(res.status).toBe(201);
  const token = (await t.call('POST', '/accounts/login', null, { email, password: 'owner-pass-1' })).body.token as string;
  return { email, token, id: res.body.business.id as string, code: res.body.business.code as string };
}
const staffLogin = (code: string) => t.call('POST', '/auth/login', null, { businessCode: code, username: 'admin', password: 'admin-pass-1' });
const emailedCode = () => /: (\d{8})$/.exec(mailOutbox.at(-1)?.subject ?? '')?.[1] ?? '';

describe('deleting a business', () => {
  it('needs the password, the emailed code and the business code, then locks it until it can be kept', async () => {
    const owner = await newBusiness();
    const del = (body: Record<string, unknown>, token = owner.token) => t.call('POST', `/accounts/businesses/${owner.id}/deletion`, token, body);

    expect((await t.call('POST', `/accounts/businesses/${owner.id}/deletion/code`, owner.token, {})).status).toBe(202);
    const code = emailedCode();
    expect(mailOutbox.at(-1)?.to).toBe(owner.email);
    expect(code).toMatch(/^\d{8}$/);

    // Every factor is checked.
    expect((await del({ password: 'wrong-pass-1', code, businessCode: owner.code })).status).toBe(400);
    expect((await del({ password: 'owner-pass-1', code: code === '00000000' ? '11111111' : '00000000', businessCode: owner.code })).status).toBe(400);
    expect((await del({ password: 'owner-pass-1', code, businessCode: 'NOPE' })).status).toBe(400);
    // Someone else's business: refused whatever they know.
    const stranger = await newBusiness();
    expect((await del({ password: 'owner-pass-1', code, businessCode: owner.code }, stranger.token)).status).toBe(403);
    expect((await staffLogin(owner.code)).status).toBe(200);

    const deleted = await del({ password: 'owner-pass-1', code, businessCode: owner.code.toLowerCase() });
    expect(deleted.status).toBe(200);
    expect(deleted.body.status).toBe('DELETING');
    const days = (Date.parse(deleted.body.deleteAfter) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(DELETION_GRACE_DAYS - 0.01);
    // The code works once; nobody can sign in now; the owner sees when it goes.
    expect((await del({ password: 'owner-pass-1', code, businessCode: owner.code })).status).toBe(400);
    expect((await staffLogin(owner.code)).status).toBe(400);
    expect((await t.ok('GET', '/accounts/businesses', owner.token)).find((row: { id: string }) => row.id === owner.id)).toMatchObject({ status: 'DELETING', deleteAfter: deleted.body.deleteAfter });

    // Kept within the grace period, with the password.
    expect((await t.call('POST', `/accounts/businesses/${owner.id}/deletion/cancel`, owner.token, { password: 'nope' })).status).toBe(400);
    expect((await t.ok('POST', `/accounts/businesses/${owner.id}/deletion/cancel`, owner.token, { password: 'owner-pass-1' })).status).toBe('ACTIVE');
    expect((await staffLogin(owner.code)).status).toBe(200);
  });

  it('erases the business, its files and its owners’ access after the grace period', async () => {
    const owner = await newBusiness();
    const business = await control().business.findUniqueOrThrow({ where: { id: owner.id } });
    // A logo it uploaded.
    const logo = `deletion-test-${randomUUID()}.png`;
    await mkdir(join(uploadsDir, 'business'), { recursive: true });
    await writeFile(join(uploadsDir, 'business', logo), 'png');
    const admin = (await staffLogin(owner.code)).body.token;
    await t.ok('PATCH', '/business/settings', admin, { logoUrl: `/uploads/business/${logo}` });

    await t.ok('POST', `/accounts/businesses/${owner.id}/deletion/code`, owner.token, {});
    await t.ok('POST', `/accounts/businesses/${owner.id}/deletion`, owner.token, { password: 'owner-pass-1', code: emailedCode(), businessCode: owner.code });
    const service = t.app.get(BusinessDeletionService);
    // Not before the grace period is over.
    expect(await service.eraseDue(new Date())).toBe(0);
    expect(await service.eraseDue(new Date(Date.now() + (DELETION_GRACE_DAYS + 1) * 86_400_000))).toBeGreaterThanOrEqual(1);

    const schemas = await control().$queryRaw<Array<{ name: string }>>`SELECT schema_name AS name FROM information_schema.schemata WHERE schema_name = ${business.schemaName}`;
    expect(schemas).toEqual([]);
    expect(existsSync(join(uploadsDir, 'business', logo))).toBe(false);
    expect(await control().membership.count({ where: { businessId: owner.id } })).toBe(0);
    expect(await control().business.findUniqueOrThrow({ where: { id: owner.id } })).toMatchObject({ status: 'DELETED', name: 'Deleted business' });
    expect((await t.ok('GET', '/accounts/businesses', owner.token)).some((row: { id: string }) => row.id === owner.id)).toBe(false);
    expect((await staffLogin(owner.code)).status).toBe(400);
    expect(mailOutbox.some((mail) => mail.to === owner.email && /has been deleted/.test(mail.subject))).toBe(true);
  });
});
