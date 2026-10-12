import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSION_COOKIE, SESSION_HEADER } from '@pos/contracts';
import { ADMIN, startApp, type TestApp } from './helpers';

// Web clients keep the sign-in in an httpOnly cookie that page scripts can't read.
let t: TestApp;
beforeAll(async () => {
  t = await startApp();
});
afterAll(async () => {
  await t.close();
});

/** A browser-like client: sends the cookie-session header (unless told not to) and keeps the cookie. */
function browser() {
  let cookie = '';
  const setCookies: string[] = [];
  async function request(method: string, path: string, body?: unknown, options: { header?: boolean; origin?: string } = {}) {
    const res = await fetch(t.baseUrl + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(options.header === false ? {} : { [SESSION_HEADER]: 'cookie' }),
        ...(cookie ? { cookie } : {}),
        ...(options.origin ? { origin: options.origin } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    for (const line of res.headers.getSetCookie()) {
      setCookies.push(line);
      const [pair] = line.split(';');
      cookie = pair.endsWith('=') ? '' : pair;
    }
    const text = await res.text();
    let parsed: any = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // not JSON
    }
    return { status: res.status, body: parsed, headers: res.headers };
  }
  return { request, setCookies, cookie: () => cookie };
}

describe('cookie sessions', () => {
  it('keep the token out of the answer and in an httpOnly cookie', async () => {
    const web = browser();
    const login = await web.request('POST', '/auth/login', { businessCode: t.businessCode, username: ADMIN.username, password: ADMIN.password });
    expect(login.status).toBe(200);
    expect(login.body.token).toBe('');
    expect(login.body.username).toBe(ADMIN.username);
    const set = web.setCookies.at(-1)!;
    expect(set).toMatch(new RegExp(`^${SESSION_COOKIE}=[^;]+;`));
    expect(set).toMatch(/HttpOnly/);
    expect(set).toMatch(/SameSite=Lax/);
    expect(set).toMatch(/Max-Age=\d+/);
    // Plain HTTP here; behind HTTPS (or a proxy saying so) the cookie is Secure.
    expect(set).not.toMatch(/Secure/);

    expect((await web.request('GET', '/auth/me')).body.username).toBe(ADMIN.username);
  });

  it('are only read with the session header, so another site can\'t ride on the cookie', async () => {
    const web = browser();
    await web.request('POST', '/auth/login', { businessCode: t.businessCode, username: ADMIN.username, password: ADMIN.password });
    expect((await web.request('GET', '/auth/me', undefined, { header: false })).status).toBe(401);
    expect((await web.request('GET', '/auth/me')).status).toBe(200);
  });

  it('follow new tokens (opening a register) and end at sign-out', async () => {
    const web = browser();
    await web.request('POST', '/auth/login', { businessCode: t.businessCode, username: ADMIN.username, password: ADMIN.password });
    const branch = await t.newBranch(await t.login());
    const before = web.cookie();
    const opened = await web.request('POST', '/registers/open', { branchId: branch.id, openingBalance: 0 });
    expect(opened.status).toBe(200);
    expect(opened.body.token).toBe('');
    expect(web.cookie()).not.toBe(before);
    expect((await web.request('GET', '/auth/me')).body.registerId).toBe(opened.body.register.id);
    await web.request('POST', '/registers/close', { closingBalance: 0 });

    const out = await web.request('POST', '/auth/logout');
    expect(out.status).toBe(204);
    expect(web.setCookies.at(-1)).toMatch(new RegExp(`^${SESSION_COOKIE}=;.*Max-Age=0`));
    expect((await web.request('GET', '/auth/me')).status).toBe(401);
  });

  it("move a new business's admin session into the cookie, but not the owner's token", async () => {
    const web = browser();
    const res = await web.request('POST', '/businesses', {
      ownerEmail: `cookie-${Date.now()}@example.com`,
      ownerPassword: 'owner-pass-1',
      businessName: 'Cookie Shop',
      adminUsername: 'admin',
      adminPassword: 'shop-admin-1'
    });
    expect(res.status).toBe(201);
    expect(res.body.session.token).toBe('');
    expect(res.body.accountToken).toMatch(/\./);
    expect((await web.request('GET', '/auth/me')).body.username).toBe('admin');
  });

  it('leave API clients alone: no header, the token comes back as before', async () => {
    const res = await t.call('POST', '/auth/login', null, { businessCode: t.businessCode, username: ADMIN.username, password: ADMIN.password });
    expect(res.body.token).toMatch(/\./);
  });

  it('let only listed origins send the cookie (no credentials for any origin)', async () => {
    const web = browser();
    const res = await web.request('GET', '/meta', undefined, { origin: 'https://evil.example' });
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
  });
});
