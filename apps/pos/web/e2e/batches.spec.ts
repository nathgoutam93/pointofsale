import { expect, test } from '@playwright/test';
import { ADMIN, call, openShop } from './shop';

// An item kept by batch, through the real screens: the sale takes the earliest expiry first and
// the bill says which batches; the stock screen shows what is left of each and what expires soon.
test('sell by batch, earliest expiry first, with the batches on the bill', async ({ page, request }) => {
  const { token, branch } = await openShop(request);
  const day = (offset: number) => {
    const date = new Date(Date.now() + offset * 86_400_000);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(date);
  };
  const item = await call(request, 'POST', '/items', token, { code: 'BATCH-SYRUP', name: 'Cough Syrup 100 ml', uom: 'PCS', sellPrice: 60, mrp: 60, taxRate: 0, tracksBatches: true });
  await call(request, 'POST', '/purchases', token, {
    branchId: branch.id,
    supplierName: 'Medi Distributors',
    lines: [
      { itemId: item.id, qty: 5, unitCost: 40, batchNo: 'LOT-LATE', expiryDate: day(200) },
      { itemId: item.id, qty: 3, unitCost: 40, batchNo: 'LOT-SOON', expiryDate: day(5) }
    ]
  });

  await page.goto('/');
  await page.fill('#login-username', ADMIN.username);
  await page.fill('#login-password', ADMIN.password);
  await page.click('button[type=submit]');
  await page.getByRole('button', { name: /^Open / }).first().click();

  await expect(page.getByText('Cough Syrup 100 ml').first()).toBeVisible();
  const scan = page.getByPlaceholder(/Scan barcode/);
  for (let i = 0; i < 4; i += 1) {
    await scan.fill('BATCH-SYRUP');
    await scan.press('Enter');
    await expect(scan).toHaveValue('');
  }
  await page.getByRole('button', { name: 'Proceed to Payment' }).click();
  await page.getByRole('button', { name: /Add \/ Update CASH/ }).click();
  await page.getByRole('button', { name: 'Validate' }).click();
  // 3 from the batch expiring first, 1 from the next.
  await expect(page.getByText(`Batch LOT-SOON exp ${day(5)}, Batch LOT-LATE exp ${day(200)}`)).toBeVisible();

  await page.goto('/stock');
  await page.getByRole('button', { name: /Cough Syrup 100 ml/ }).first().click();
  const batches = page.locator('.card', { has: page.getByRole('heading', { name: 'Batches' }) });
  await expect(batches.getByRole('row', { name: /LOT-LATE/ })).toContainText('4');
  await expect(batches.getByRole('row', { name: /LOT-SOON/ })).toHaveCount(0);
  // Nothing left expires within 30 days; within a year, the later batch does.
  const expiring = page.locator('.card', { has: page.getByRole('heading', { name: 'Expiring stock' }) });
  await expect(expiring).toContainText('Nothing expires within 30 days');
  await expiring.getByRole('spinbutton').fill('365');
  await expect(expiring.getByRole('row', { name: /LOT-LATE/ })).toBeVisible();

  // Close the register for the next test: 4 at ₹60 taken in cash.
  await page.getByRole('button', { name: 'Close Register' }).first().click();
  await page.getByPlaceholder('0.00').fill('240');
  const dialog = page.getByRole('dialog', { name: 'Close Register' });
  await dialog.getByRole('button', { name: 'Close Register' }).click();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page).toHaveURL(/\/open-register$/);
});
