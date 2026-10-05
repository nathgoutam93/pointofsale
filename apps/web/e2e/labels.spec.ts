import { expect, test } from '@playwright/test';
import { ADMIN, call, openShop } from './shop';

// Barcode labels: the item's barcode (or its code), the price with GST and the MRP, on a roll or an A4 sheet.
test('print barcode labels on a roll and on A4 sheets', async ({ page, request }) => {
  const { token } = await openShop(request);
  const soap = await call(request, 'POST', '/items', token, {
    code: 'LBL-SOAP', name: 'Sandal Soap 100 g', uom: 'PCS', sellPrice: 50, mrp: 65, taxRate: 18, taxMode: 'EXCLUSIVE', barcodes: [{ barcode: '8901030865278' }]
  });
  await call(request, 'POST', '/items', token, { code: 'LBL-BAG', name: 'Cloth Bag', uom: 'PCS', sellPrice: 20, taxRate: 0, taxMode: 'INCLUSIVE' });

  // Printing is counted instead of opening the dialog, in every frame.
  await page.addInitScript(() => {
    window.print = () => {
      const top = window.top as unknown as { printed?: number };
      top.printed = (top.printed ?? 0) + 1;
    };
  });
  await page.goto('/');
  await page.fill('#login-username', ADMIN.username);
  await page.fill('#login-password', ADMIN.password);
  await page.click('button[type=submit]');
  await page.waitForURL(/\/(pos|open-register)/);

  await page.goto(`/labels?itemId=${soap.id}`);
  await page.getByLabel('Labels of Sandal Soap 100 g').fill('3');
  await page.getByLabel('Print on').selectOption('ROLL_50X25');
  const preview = page.frameLocator('iframe[title="Label preview"]');
  await expect(preview.locator('.label').first()).toContainText('Sandal Soap 100 g');
  // 50 + 18% GST, beside the MRP.
  await expect(preview.locator('.label').first()).toContainText('₹59.00');
  await expect(preview.locator('.label').first()).toContainText('MRP ₹65.00');
  await expect(preview.locator('.code').first()).toHaveText('8901030865278');
  await expect(preview.locator('svg.bc rect').first()).toBeAttached();

  // An item without a barcode gets its item code.
  await page.getByLabel('Search items').fill('Cloth');
  await page.getByRole('button', { name: /Cloth Bag/ }).click();
  await expect(page.getByLabel('Barcode for Cloth Bag')).toHaveValue('LBL-BAG');

  await page.getByLabel('Print on').selectOption('A4_65');
  await page.getByLabel('Start at label (on a part-used sheet)').fill('6');
  await expect(preview.locator('.slot')).toHaveCount(9);
  await expect(preview.locator('.label')).toHaveCount(4);
  if (process.env.E2E_SCREENSHOTS) await page.locator('iframe[title="Label preview"]').screenshot({ path: `${process.env.E2E_SCREENSHOTS}/labels-a4.png` });

  await page.getByRole('button', { name: 'Print 4 labels' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { printed?: number }).printed ?? 0)).toBe(1);
});
