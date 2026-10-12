import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { APP_VERSION } from '@pos/contracts';
import { ReportsService } from '../src/reports/reports.service';
import { TenancyService } from '../src/tenancy/tenancy.service';
import { startApp, type TestApp } from './helpers';

// Crash reports on the online server: from apps (scrubbed, rate-limited, never needing a
// sign-in) and from the server's own unexpected errors.
let t: TestApp;
let admin: string;
const control = () => t.app.get(TenancyService).control;

beforeAll(async () => {
  t = await startApp();
  admin = await t.login();
  await control().crashReport.deleteMany({});
});
afterAll(async () => {
  await t.close();
});

const report = (overrides: Record<string, unknown> = {}) => ({
  source: 'page',
  appVersion: '0.1.2',
  mode: 'online',
  os: 'Windows 10',
  message: "TypeError: Cannot read properties of undefined (reading 'qty')",
  stack: 'at CartLines (app://pos/assets/index.js:10:5)',
  occurredAt: new Date().toISOString(),
  ...overrides
});

describe('crash reports', () => {
  it('are kept from any app, scrubbed again, with the business only from a valid sign-in', async () => {
    const anonymous = await t.call('POST', '/crash-reports', null, {
      reports: [report({ source: 'desktop', mode: 'offline', installId: '6f1c1b1e-6a5b-4b8f-9a55-0d3b6c1f2a10', message: 'Mail to ravi@shop.example failed' })]
    });
    expect(anonymous.status).toBe(202);
    expect(anonymous.body).toEqual({ received: 1 });
    const signedIn = await t.call('POST', '/crash-reports', admin, { reports: [report(), report()] });
    expect(signedIn.body).toEqual({ received: 2 });

    const rows = await control().crashReport.findMany({ orderBy: { receivedAt: 'asc' } });
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ source: 'desktop', message: 'Mail to <email> failed', businessId: null, installId: '6f1c1b1e-6a5b-4b8f-9a55-0d3b6c1f2a10' });
    const businessId = (await control().business.findUniqueOrThrow({ where: { code: t.businessCode! } })).id;
    expect(rows[1].businessId).toBe(businessId);
    // The same crash groups together.
    expect(rows[1].fingerprint).toBe(rows[2].fingerprint);
    expect(rows[0].fingerprint).not.toBe(rows[1].fingerprint);

    expect((await t.call('POST', '/crash-reports', null, { reports: [report({ source: 'elsewhere' })] })).status).toBe(400);
    expect((await t.call('POST', '/crash-reports', null, { reports: [] })).status).toBe(400);
  });

  it("keep the server's own unexpected errors, without what the request carried", async () => {
    const branchId = (await t.ok('GET', '/branches', admin))[0].id;
    const failure = new Error('kaboom for 9876543210\nInvalid `prisma.customer.findMany()` invocation: { name: "Ravi" }');
    const spy = vi.spyOn(t.app.get(ReportsService), 'getSalesSummary').mockRejectedValueOnce(failure);
    try {
      expect((await t.call('GET', `/reports/sales-summary?branchId=${branchId}`, admin)).status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    // Expected errors (a 400, a 404) are not crashes.
    expect((await t.call('GET', '/reports/sales-summary?branchId=nope', admin)).status).toBe(400);
    await vi.waitFor(async () => expect(await control().crashReport.count({ where: { source: 'server' } })).toBe(1));
    const kept = await control().crashReport.findFirstOrThrow({ where: { source: 'server' } });
    expect(kept).toMatchObject({ mode: 'server', appVersion: APP_VERSION, message: 'kaboom for <number>' });
    expect(kept.stack).not.toContain('Ravi');
    expect(kept.stack).toMatch(/^at /);
  });
});
