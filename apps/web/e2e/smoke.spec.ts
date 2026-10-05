import { expect, test, type APIRequestContext } from '@playwright/test';

// The day's work at one counter, through the real screens: sign in, open the register, sell
// with change, take a return, close the register with the cash counted.
const API = `http://localhost:${process.env.E2E_API_PORT ?? 3101}`;
const ADMIN = { username: 'admin', password: 'admin-pass-123' };

async function call(request: APIRequestContext, method: 'GET' | 'POST', path: string, token?: string, data?: unknown) {
  const res = await request.fetch(`${API}${path}`, { method, data, headers: token ? { authorization: `Bearer ${token}` } : {} });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.json();
}

test('sign in, sell, return and close the register', async ({ page, request }) => {
  // A new shop with one item in stock.
  await call(request, 'POST', '/setup', undefined, { businessName: 'Smoke Test Stores', adminUsername: ADMIN.username, adminPassword: ADMIN.password });
  const { token } = await call(request, 'POST', '/auth/login', undefined, ADMIN);
  const [branch] = await call(request, 'GET', '/branches', token);
  const item = await call(request, 'POST', '/items', token, {
    code: 'SMOKE-TEA', name: 'Smoke Test Tea', uom: 'PCS', sellPrice: 120, mrp: 120, taxRate: 5, taxMode: 'INCLUSIVE'
  });
  await call(request, 'POST', '/stock/opening', token, { branchId: branch.id, itemId: item.id, qty: 10 });

  await page.goto('/');
  await page.fill('#login-username', ADMIN.username);
  await page.fill('#login-password', ADMIN.password);
  await page.click('button[type=submit]');
  await page.getByRole('button', { name: /^Open / }).first().click();

  // Two scanned, paid with a 500 note: 240 due, 260 change.
  await expect(page.getByText('Smoke Test Tea').first()).toBeVisible();
  const scan = page.getByPlaceholder(/Scan barcode/);
  for (let i = 0; i < 2; i += 1) {
    await scan.fill('SMOKE-TEA');
    await scan.press('Enter');
    await expect(scan).toHaveValue('');
  }
  await page.getByRole('button', { name: 'Proceed to Payment' }).click();
  await page.getByRole('button', { name: 'Clear' }).click();
  for (const key of ['5', '0', '0']) await page.getByRole('button', { name: key, exact: true }).click();
  await page.getByRole('button', { name: /Add \/ Update CASH/ }).click();
  await page.getByRole('button', { name: 'Validate' }).click();
  await expect(page.getByText(/Give back/)).toContainText('260');

  // One comes back, refunded in cash.
  const [sale] = await call(request, 'GET', `/sales?branchId=${branch.id}&limit=1`, token);
  expect(Number(sale.grandTotal)).toBe(240);
  await page.goto('/returns');
  await page.getByRole('button', { name: 'New Return' }).click();
  await page.getByPlaceholder('Type invoice no or customer name').fill(sale.invoiceNo);
  await page.getByRole('button', { name: new RegExp(sale.invoiceNo) }).click();
  await page.getByRole('spinbutton').fill('1');
  await page.getByPlaceholder(/Why the goods came back/).fill('Smoke test: damaged pack');
  await page.getByRole('button', { name: 'Create Return' }).click();
  await expect(page.getByText(/^Return created: /)).toBeVisible();

  // The drawer holds 240 taken less 120 refunded.
  await page.getByRole('button', { name: 'Close Register' }).first().click();
  await page.getByPlaceholder('0.00').fill('120');
  const dialog = page.getByRole('dialog', { name: 'Close Register' });
  await dialog.getByRole('button', { name: 'Close Register' }).click();
  await expect(dialog.getByText('Expected cash').locator('..')).toContainText('120.00');
  await expect(dialog.getByText('Difference').locator('..')).toContainText('Balanced');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page).toHaveURL(/\/open-register$/);
  await expect(page.getByRole('heading', { name: 'Open a register' })).toBeVisible();
});
