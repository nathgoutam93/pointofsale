import { expect, test } from '@playwright/test';
import { ADMIN, call, openShop } from './shop';

// Buying from a supplier, paying part of it and sending goods back, through the real screens.
test('buy from a new supplier, pay part, send goods back', async ({ page, request }) => {
  const { token } = await openShop(request);
  await call(request, 'POST', '/items', token, { code: 'SUP-RICE', name: 'Supplier Test Rice', uom: 'PCS', sellPrice: 80, mrp: 80, taxRate: 0, taxMode: 'EXCLUSIVE' });

  await page.goto('/');
  await page.fill('#login-username', ADMIN.username);
  await page.fill('#login-password', ADMIN.password);
  await page.click('button[type=submit]');
  await page.waitForURL(/\/(pos|open-register)/);

  // 10 at ₹50 from a supplier added with the purchase.
  await page.goto('/purchases');
  await page.getByRole('combobox', { name: 'Supplier', exact: true }).selectOption('new');
  await page.getByLabel("New supplier's name").fill('Ganesh Wholesale');
  const picker = page.getByPlaceholder('Add an item by name or code');
  await picker.fill('SUP-RICE');
  await picker.press('Enter');
  const row = page.getByRole('row', { name: /Supplier Test Rice/ });
  await row.getByRole('spinbutton').first().fill('10');
  await row.getByRole('spinbutton').nth(1).fill('50');
  await page.getByRole('button', { name: 'Save Purchase' }).click();
  await expect(page.getByText(/saved\. Stock and item costs are updated/)).toBeVisible();

  // The supplier is owed ₹500; ₹200 paid by bank leaves ₹300.
  await page.goto('/suppliers');
  await page.getByRole('button', { name: /Ganesh Wholesale/ }).click();
  await expect(page.getByText('We owe').locator('..')).toContainText('500.00');
  await page.getByLabel('Amount').fill('200');
  await page.getByLabel('Reference (cheque no., UTR...)').fill('UTR-42');
  await page.getByRole('button', { name: 'Record Payment' }).click();
  await expect(page.getByText(/Paid ₹200\.00 to Ganesh Wholesale/)).toBeVisible();
  await expect(page.getByText('We owe').locator('..')).toContainText('300.00');

  // 2 go back damaged: ₹100 off what is owed.
  await page.goto('/purchases');
  await page.getByRole('button', { name: /Ganesh Wholesale/ }).first().click();
  await page.getByLabel('Send back Supplier Test Rice').fill('2');
  await page.getByPlaceholder('Damaged, expired, wrong item...').fill('Damaged bags');
  await page.getByRole('button', { name: 'Send Back to Supplier' }).click();
  await expect(page.getByText(/₹100\.00 comes off what Ganesh Wholesale is owed/)).toBeVisible();

  await page.goto('/suppliers');
  await page.getByRole('button', { name: /Ganesh Wholesale/ }).click();
  await expect(page.getByText('We owe').locator('..')).toContainText('200.00');
  await expect(page.getByText(/Sent back/)).toBeVisible();
});
