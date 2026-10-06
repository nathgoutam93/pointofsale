import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { ADMIN } from '../shop';
import { openDemoShop } from './demoShop';
import { areaOf, chooseIn, clickOn, glideTo, MAIN_AREA, record, typeInto, VIEWPORT, type Clip } from './recorder';

// Makes the GIFs the screen tours play (apps/web/src/tour/gifs), from the real app on a demo shop:
// `pnpm --filter @pos/web tour:gifs` (the API built first, as for the e2e tests). Run it again
// when a screen in a clip changes. ONLY=pos-checkout,items-new records just those.
const OUT = join(__dirname, '../../src/tour/gifs');
const only = process.env.ONLY?.split(',').filter(Boolean);

const tour = (page: Page, target: string) => page.locator(`[data-tour="${target}"]`);

const openRegister: Clip = {
  name: 'open-register',
  setup: async (page) => {
    await page.goto('/open-register');
    await expect(tour(page, 'register-counters')).toBeVisible();
    return areaOf([tour(page, 'register-counters'), tour(page, 'register-open')], 24);
  },
  act: async (page) => {
    await clickOn(page, tour(page, 'register-counters').getByRole('button').first());
    await typeInto(page, page.getByPlaceholder('0.00'), '2000');
    await page.waitForTimeout(300);
    await clickOn(page, page.getByRole('button', { name: /^Open / }));
    await page.waitForURL(/\/pos$/);
    await page.waitForTimeout(800);
  }
};

const clips: Clip[] = [
  {
    name: 'pos-checkout',
    setup: async (page) => {
      await page.goto('/pos');
      await expect(page.getByRole('button', { name: 'New Order' })).toBeVisible();
      return MAIN_AREA;
    },
    act: async (page) => {
      await clickOn(page, page.getByRole('button', { name: 'New Order' }));
      await clickOn(page, page.getByRole('button', { name: /Assam Tea 500 g/ }));
      await clickOn(page, page.getByRole('button', { name: /Butter Biscuits 200 g/ }));
      await clickOn(page, page.getByRole('button', { name: /Butter Biscuits 200 g/ }));
      await clickOn(page, page.getByRole('button', { name: 'Proceed to Payment' }), 600);
      await clickOn(page, page.getByRole('button', { name: 'Clear' }), 200);
      for (const key of ['5', '0', '0']) await clickOn(page, page.getByRole('button', { name: key, exact: true }), 150);
      await clickOn(page, page.getByRole('button', { name: /Add \/ Update CASH/ }), 500);
      await clickOn(page, page.getByRole('button', { name: 'Validate' }));
      await expect(page.getByText(/Give back/)).toBeVisible();
      await page.waitForTimeout(1200);
    }
  },
  {
    name: 'pos-add-items',
    setup: async (page) => {
      await page.goto('/pos');
      await page.getByRole('button', { name: 'New Order' }).click();
      await expect(tour(page, 'pos-cart')).toBeVisible();
      return MAIN_AREA;
    },
    act: async (page) => {
      const scan = page.getByPlaceholder(/Scan barcode/);
      await typeInto(page, scan, 'TEA-500');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(600);
      await scan.pressSequentially('TEA-500', { delay: 85 });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(600);
      await typeInto(page, page.getByPlaceholder('Search products'), 'juice');
      await clickOn(page, page.getByRole('button', { name: /Mango Juice 1 L/ }), 700);
    }
  },
  {
    name: 'sales-find-bill',
    setup: async (page) => {
      await page.goto('/sales');
      await expect(tour(page, 'sales-list')).toBeVisible();
      return MAIN_AREA;
    },
    act: async (page) => {
      await typeInto(page, page.getByPlaceholder(/Search by invoice/), 'Priya');
      await clickOn(page, tour(page, 'sales-list').getByRole('button').first(), 800);
      await clickOn(page, page.getByRole('button', { name: 'A4', exact: true }), 1500);
      await clickOn(page, page.getByRole('button', { name: 'A4', exact: true }), 600);
      await glideTo(page, page.getByRole('button', { name: 'Print' }));
    }
  },
  {
    name: 'returns-new',
    setup: async (page) => {
      await page.goto('/returns');
      await expect(tour(page, 'returns-new')).toBeEnabled();
      return MAIN_AREA;
    },
    act: async (page) => {
      await clickOn(page, tour(page, 'returns-new'), 500);
      await typeInto(page, page.getByPlaceholder('Type invoice no or customer name'), 'Priya');
      await clickOn(page, page.getByRole('button', { name: /Priya Sharma/ }).first(), 600);
      await typeInto(page, page.getByRole('spinbutton').first(), '1');
      await typeInto(page, page.getByPlaceholder(/Why the goods came back/), 'Damaged pack');
      await clickOn(page, page.getByRole('button', { name: 'Create Return' }));
      await expect(page.getByText(/^Return created: /)).toBeVisible();
    }
  },
  {
    name: 'items-new',
    setup: async (page) => {
      await page.goto('/items');
      await expect(tour(page, 'items-new')).toBeVisible();
      return MAIN_AREA;
    },
    act: async (page) => {
      await clickOn(page, tour(page, 'items-new'), 500);
      await typeInto(page, page.getByPlaceholder('e.g. SKU-1001'), 'GHEE-500');
      await typeInto(page, page.getByPlaceholder('e.g. Classic T-Shirt'), 'Desi Ghee 500 ml');
      await typeInto(page, page.getByLabel('Category'), 'Grocery');
      await typeInto(page, page.getByLabel('Sell Price'), '325');
      await typeInto(page, page.getByLabel('MRP'), '340');
      await chooseIn(page, page.getByLabel('Tax Mode'), 'INCLUSIVE');
      await typeInto(page, page.getByLabel('Tax %'), '12');
      await clickOn(page, page.getByRole('button', { name: 'Create Item' }), 900);
      await expect(page.getByText('Desi Ghee 500 ml').first()).toBeVisible();
    }
  },
  {
    name: 'customers-new',
    setup: async (page) => {
      await page.goto('/customers');
      await expect(tour(page, 'customers-new')).toBeVisible();
      return MAIN_AREA;
    },
    act: async (page) => {
      await clickOn(page, tour(page, 'customers-new'), 400);
      await typeInto(page, page.getByPlaceholder('Customer name'), 'Vikram Singh');
      await typeInto(page, page.getByPlaceholder('Phone (optional)').first(), '9822001122');
      await clickOn(page, page.getByRole('button', { name: 'Create Customer' }), 900);
      await expect(page.getByText('Vikram Singh').first()).toBeVisible();
    }
  },
  {
    name: 'expenses-add',
    setup: async (page) => {
      await page.goto('/expenses');
      await expect(tour(page, 'expenses-add')).toBeEnabled();
      return MAIN_AREA;
    },
    act: async (page) => {
      await clickOn(page, tour(page, 'expenses-add'), 400);
      await typeInto(page, page.getByLabel('Category'), 'Shop rent');
      await typeInto(page, page.getByLabel('Amount'), '12000');
      await chooseIn(page, page.getByLabel('Paid by'), { label: 'Bank transfer' });
      await clickOn(page, page.getByRole('button', { name: 'Save Expense' }), 900);
      await expect(page.getByText('Shop rent').first()).toBeVisible();
    }
  },
  {
    name: 'stock-adjust',
    setup: async (page) => {
      await page.goto('/stock');
      await expect(tour(page, 'stock-list')).toBeVisible();
      return MAIN_AREA;
    },
    act: async (page) => {
      await typeInto(page, page.getByPlaceholder('Search by item or code'), 'soap');
      await clickOn(page, tour(page, 'stock-list').getByText('Neem Soap 100 g'), 600);
      await clickOn(page, page.getByRole('button', { name: 'Stock Adjustment' }), 500);
      await chooseIn(page, page.getByLabel('Direction'), 'OUT');
      await typeInto(page, page.getByLabel('Quantity'), '1');
      await typeInto(page, page.getByLabel('Reason'), 'Damaged pack');
      await clickOn(page, page.getByRole('button', { name: 'Submit Stock Adjustment' }), 900);
    }
  },
  {
    name: 'purchases-new',
    setup: async (page) => {
      await page.goto('/purchases');
      await expect(tour(page, 'purchases-supplier')).toBeVisible();
      return MAIN_AREA;
    },
    act: async (page) => {
      await chooseIn(page, tour(page, 'purchases-supplier').locator('select').first(), { index: 1 });
      await typeInto(page, page.getByLabel(/Supplier invoice no/), 'SWT-1101');
      await typeInto(page, page.getByPlaceholder('Add an item by name or code'), 'oil');
      await clickOn(page, page.getByRole('button', { name: /Sunflower Oil 1 L/ }), 400);
      const row = tour(page, 'purchases-lines').locator('tbody tr').first();
      await typeInto(page, row.locator('input[type=number]').nth(0), '24');
      await typeInto(page, row.locator('input[type=number]').nth(1), '105');
      await clickOn(page, tour(page, 'purchases-save'), 900);
      await expect(page.getByText(/SWT-1101/).first()).toBeVisible();
    }
  },
  {
    name: 'suppliers-pay',
    setup: async (page) => {
      await page.goto('/suppliers');
      await expect(tour(page, 'suppliers-list')).toBeVisible();
      return MAIN_AREA;
    },
    act: async (page) => {
      await clickOn(page, tour(page, 'suppliers-list').getByRole('button').first(), 700);
      await typeInto(page, page.getByLabel('Amount'), '2000');
      await chooseIn(page, page.getByLabel('Paid by'), { label: 'UPI' });
      await typeInto(page, page.getByLabel(/Reference/), 'UTR 4521');
      await clickOn(page, page.getByRole('button', { name: 'Record Payment' }), 1000);
    }
  },
  {
    name: 'labels-print',
    setup: async (page) => {
      await page.goto('/labels');
      await expect(tour(page, 'labels-add')).toBeVisible();
      return MAIN_AREA;
    },
    act: async (page) => {
      await typeInto(page, page.getByLabel('Search items'), 'tea');
      await clickOn(page, tour(page, 'labels-add').getByRole('button', { name: /Assam Tea 500 g/ }), 600);
      await typeInto(page, page.getByLabel('Labels of Assam Tea 500 g'), '12');
      await page.waitForTimeout(800);
      await glideTo(page, tour(page, 'labels-print'));
    }
  },
  {
    name: 'settings-tabs',
    setup: async (page) => {
      await page.goto('/settings');
      await expect(tour(page, 'settings-tab-business')).toBeVisible();
      return MAIN_AREA;
    },
    act: async (page) => {
      for (const tab of ['branches', 'receipts', 'cashiers', 'data', 'business']) {
        await clickOn(page, tour(page, `settings-tab-${tab}`), 1100);
      }
    }
  }
];

test('record the tour clips', async ({ browser, page, request }) => {
  test.setTimeout(15 * 60_000);
  await openDemoShop(request);

  // Signed in, no register open yet.
  await page.setViewportSize(VIEWPORT);
  await page.goto('/');
  await page.fill('#login-username', ADMIN.username);
  await page.fill('#login-password', ADMIN.password);
  await page.click('button[type=submit]');
  await page.waitForURL(/\/open-register$/);
  let state = await page.context().storageState();

  // Opening the register is a clip itself; the rest start with it open.
  if (!only || only.includes(openRegister.name)) {
    state = await record(browser, OUT, openRegister, state);
  } else {
    await page.getByRole('button', { name: /^Open / }).first().click();
    await page.waitForURL(/\/pos$/);
    state = await page.context().storageState();
  }
  for (const clip of clips) {
    if (only && !only.includes(clip.name)) continue;
    await test.step(clip.name, () => record(browser, OUT, clip, state));
  }
});
