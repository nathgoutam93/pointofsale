import { expect, test } from '@playwright/test';
import { randomUUID } from 'crypto';
import { ADMIN, call, openShop } from './shop';

// Any bill can be shown and printed as a full-page A4 invoice from the Sales screen.
test('show a bill as an A4 invoice', async ({ page, request }) => {
  const { token, branch } = await openShop(request);
  const item = await call(request, 'POST', '/items', token, { code: 'A4-TEA', name: 'Assam Tea 500 g', uom: 'PCS', sellPrice: 236, mrp: 236, taxRate: 18, taxMode: 'INCLUSIVE', hsnCode: '0902' });
  await call(request, 'POST', '/stock/opening', token, { branchId: branch.id, itemId: item.id, qty: 10 });
  const register = await call(request, 'POST', '/registers/open', token, { branchId: branch.id, openingBalance: 0 });
  const walkIn = await call(request, 'GET', `/customers/walk-in/${branch.id}`, register.token);
  const sale = await call(request, 'POST', '/sales/checkout', register.token, {
    branchId: branch.id,
    customerId: walkIn.id,
    lines: [{ itemId: item.id, qty: 5, rate: 236, taxRate: 18, taxMode: 'INCLUSIVE' }],
    payments: [{ mode: 'CASH', amount: 1180 }],
    idempotencyKey: randomUUID()
  });
  await call(request, 'POST', '/registers/close', register.token, { closingBalance: 1180 });

  await page.goto('/');
  await page.fill('#login-username', ADMIN.username);
  await page.fill('#login-password', ADMIN.password);
  await page.click('button[type=submit]');
  await page.waitForURL(/\/(pos|open-register)/);
  await page.goto('/sales');
  await page.getByRole('button', { name: new RegExp(sale.invoice.invoiceNo) }).first().click();
  await page.getByRole('button', { name: 'A4', exact: true }).click();

  const invoice = page.locator('#printable-invoice');
  await expect(invoice).toContainText('TAX INVOICE');
  await expect(invoice).toContainText('Assam Tea 500 g');
  await expect(invoice).toContainText('0902');
  await expect(invoice).toContainText('Rupees One Thousand One Hundred Eighty Only');
  await expect(invoice).toContainText('Authorised signatory');
  if (process.env.E2E_SCREENSHOTS) await invoice.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/a4-invoice.png` });
});
