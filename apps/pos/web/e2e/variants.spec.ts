import { expect, test } from '@playwright/test';
import { ADMIN, call, openShop } from './shop';

// A shirt in sizes and colours: made on the Items screen, picked by size and colour at the
// counter; then tea paid from the drawer, counted at close.
test('sell a size and colour, and pay an expense from the drawer', async ({ page, request }) => {
  const { token, branch } = await openShop(request);

  await page.goto('/');
  await page.fill('#login-username', ADMIN.username);
  await page.fill('#login-password', ADMIN.password);
  await page.click('button[type=submit]');
  await page.waitForURL(/\/(pos|open-register)/);

  await page.goto('/items');
  await page.getByRole('button', { name: 'Sizes / Colours' }).click();
  await page.getByLabel('Product name').fill('Linen Shirt');
  await page.getByLabel('Code prefix').fill('LINEN');
  await page.getByLabel('Its values (comma-separated)').first().fill('M, L');
  await page.getByLabel('Its values (comma-separated)').nth(1).fill('White, Sky Blue');
  await page.getByLabel('Selling price').fill('899');
  await page.getByLabel('MRP').fill('999');
  await expect(page.getByText('4 items, coded like LINEN-M-WHITE')).toBeVisible();
  await page.getByRole('button', { name: 'Create 4 Items' }).click();
  await expect(page.getByText('Variant of Linen Shirt')).toBeVisible();
  await expect(page.getByRole('button', { name: 'L / Sky Blue · ₹899.00', exact: true })).toBeVisible();

  const groups = await call(request, 'GET', '/item-groups', token);
  const shirt = groups.find((group: { name: string }) => group.name === 'Linen Shirt');
  const largeSky = shirt.items.find((item: { code: string }) => item.code === 'LINEN-L-SKYBLUE');
  await call(request, 'POST', '/stock/opening', token, { branchId: branch.id, itemId: largeSky.id, qty: 3 });

  await page.goto('/open-register');
  await page.getByRole('button', { name: /^Open / }).first().click();
  await page.getByPlaceholder('Search products').fill('Linen');
  await page.getByRole('button', { name: /Linen Shirt.*sizes & colours/ }).click();
  const picker = page.getByRole('dialog', { name: 'Linen Shirt' });
  await expect(picker.getByRole('button', { name: 'Linen Shirt L Sky Blue' })).toContainText('3 left');
  if (process.env.E2E_SCREENSHOTS) await picker.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/variant-picker.png` });
  await picker.getByRole('button', { name: 'Linen Shirt L Sky Blue' }).click();
  await expect(page.getByText('Linen Shirt L / Sky Blue').first()).toBeVisible();

  await page.getByRole('button', { name: 'Proceed to Payment' }).click();
  await page.getByRole('button', { name: 'Clear' }).click();
  for (const key of ['8', '9', '9']) await page.getByRole('button', { name: key, exact: true }).click();
  await page.getByRole('button', { name: /Add \/ Update CASH/ }).click();
  await page.getByRole('button', { name: 'Validate' }).click();
  await expect(page.getByRole('button', { name: 'New Order' })).toBeVisible();

  // Tea for 50 from the drawer.
  await page.getByRole('button', { name: 'Cash In / Out' }).first().click();
  const cash = page.getByRole('dialog', { name: 'Cash In / Out' });
  await cash.getByLabel('Amount').fill('50');
  await cash.getByLabel('Category').fill('Tea and snacks');
  await cash.getByRole('button', { name: 'Pay an expense' }).last().click();
  await expect(cash.getByRole('status')).toHaveText('Expense of ₹50.00 paid from the drawer.');
  await expect(cash.getByText('Expense · Tea and snacks')).toBeVisible();
  await cash.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Close Register' }).first().click();
  const close = page.getByRole('dialog', { name: 'Close Register' });
  await expect(close.getByText('Expenses paid').locator('..')).toContainText('50.00');
  await page.getByPlaceholder('0.00').fill('849');
  await close.getByRole('button', { name: 'Close Register' }).click();
  await expect(close.getByText('Difference').locator('..')).toContainText('Balanced');
  await close.getByRole('button', { name: 'Done' }).click();
});
