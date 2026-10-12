import { expect, test } from '@playwright/test';
import { ADMIN, openShop } from './shop';

// The guided tour of a screen: it starts by itself the first time, plays its clip, ends with
// Done, doesn't come back by itself, and the ? button shows it again.
test.use({ storageState: { cookies: [], origins: [] } });

test('a screen tour starts once by itself and again from the ? button', async ({ page, request }) => {
  await openShop(request);
  await page.goto('/');
  await page.fill('#login-username', ADMIN.username);
  await page.fill('#login-password', ADMIN.password);
  await page.click('button[type=submit]');
  await page.waitForURL(/\/(pos|open-register)$/);

  await page.goto('/items');
  const first = page.getByRole('alertdialog', { name: 'Add an item' });
  await expect(first).toBeVisible();
  // Its clip loads.
  await expect.poll(() => first.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  // Next through to Done.
  for (let step = 0; step < 12; step += 1) {
    const button = page.getByRole('alertdialog').getByRole('button', { name: /^(Next|Done)$/ });
    if ((await button.count()) === 0) break;
    await button.click();
  }
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  // Seen: not again by itself.
  await page.reload();
  await expect(page.getByRole('button', { name: 'New Item' })).toBeVisible();
  await page.waitForTimeout(3500);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  // The ? button shows it again; Escape ends it.
  await page.getByRole('button', { name: 'Show the tour of Items' }).click();
  await expect(page.getByRole('alertdialog', { name: 'Add an item' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});
