import { expect, test } from '@playwright/test';
import { join } from 'path';
import { ADMIN, call, openShop } from './shop';

// Items from a spreadsheet: a CSV with a mistake is refused row by row, then fixed and
// imported; an Excel file brings in a product's sizes with their stock.
test('import items from a CSV and an Excel file', async ({ page, request }) => {
  const { token, branch } = await openShop(request);
  await page.goto('/');
  await page.fill('#login-username', ADMIN.username);
  await page.fill('#login-password', ADMIN.password);
  await page.click('button[type=submit]');
  await page.waitForURL(/\/(pos|open-register)/);

  await page.goto('/items');
  await page.getByRole('link', { name: /Import items from a spreadsheet/ }).click();
  await expect(page.getByRole('heading', { name: 'Import Items' })).toBeVisible();

  const csv = (rows: string[]) => ({ name: 'items.csv', mimeType: 'text/csv', buffer: Buffer.from(['Code,Name,Unit,Selling price,MRP,GST %,Barcodes,Opening stock', ...rows].join('\r\n')) });
  const file = page.getByLabel('Spreadsheet file');
  await file.setInputFiles(csv(['IMP-TEA,"Masala Tea, 250 g",PCS,120,130,5,8901725181222,12', 'IMP-OIL,Mustard Oil 1 L,BTL,two hundred,,5,,']));
  await expect(page.getByText('items.csv: 2 items')).toBeVisible();
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.getByRole('status')).toHaveText('1 problem to fix in the file; nothing was saved.');
  await expect(page.getByRole('row', { name: /3 Selling price: "two hundred" isn't a number/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();

  await file.setInputFiles(csv(['IMP-TEA,"Masala Tea, 250 g",PCS,120,130,5,8901725181222,12', 'IMP-OIL,Mustard Oil 1 L,BTL,200,,5,,']));
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.getByRole('status')).toHaveText('Ready: 2 to add, 0 to update. Press Import to save them.');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Imported: 2 added, 0 updated.');

  const items = await call(request, 'GET', '/items', token);
  const tea = items.find((item: { code: string }) => item.code === 'IMP-TEA');
  expect(tea).toMatchObject({ name: 'Masala Tea, 250 g', taxMode: 'INCLUSIVE', barcodes: [{ barcode: '8901725181222' }] });
  const [teaStock] = await call(request, 'GET', `/stock/on-hand?branchId=${branch.id}&itemId=${tea.id}`, token);
  expect(teaStock.onHand).toBe(12);

  await file.setInputFiles(join(__dirname, 'fixtures', 'items.xlsx'));
  await expect(page.getByText('items.xlsx: 3 items')).toBeVisible();
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.getByRole('status')).toHaveText('Ready: 3 to add, 0 to update. Press Import to save them.');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Imported: 3 added, 0 updated.');
  const groups = await call(request, 'GET', '/item-groups', token);
  const jeans = groups.find((group: { name: string }) => group.name === 'Slim Jeans');
  expect(jeans.items.map((item: { option1: string }) => item.option1)).toEqual(['30', '32']);
  const low = await call(request, 'GET', `/stock/low?branchId=${branch.id}`, token);
  expect(low).toEqual([]);
});
