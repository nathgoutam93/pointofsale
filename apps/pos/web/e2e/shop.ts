import { expect, type APIRequestContext } from '@playwright/test';

// What the end-to-end tests share: the API they set up through, and one shop with its admin.
export const API = `http://localhost:${process.env.E2E_API_PORT ?? 3101}`;
export const ADMIN = { username: 'admin', password: 'admin-pass-123' };

export async function call(request: APIRequestContext, method: 'GET' | 'POST' | 'PUT', path: string, token?: string, data?: unknown) {
  const res = await request.fetch(`${API}${path}`, { method, data, headers: token ? { authorization: `Bearer ${token}` } : {} });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.json();
}

/** The shop (set up by whichever test runs first) and an admin token for it. */
export async function openShop(request: APIRequestContext) {
  const setup = await request.post(`${API}/setup`, {
    // A regular GST business, so bills are tax invoices and prices carry GST (a shop without a GSTIN is unregistered).
    data: { businessName: 'Smoke Test Stores', taxpayerType: 'REGULAR', gstNumber: '29ABCDE1234F1ZW', adminUsername: ADMIN.username, adminPassword: ADMIN.password }
  });
  expect([201, 409], await setup.text()).toContain(setup.status());
  const { token } = await call(request, 'POST', '/auth/login', undefined, ADMIN);
  const [branch] = await call(request, 'GET', '/branches', token);
  return { token, branch };
}
