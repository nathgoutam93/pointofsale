import { randomUUID } from 'crypto';
import type { APIRequestContext } from '@playwright/test';
import { call, openShop } from '../shop';

// A small, lived-in shop for recording the tour's GIFs: items in a few categories with stock,
// customers, a supplier with a purchase, a few bills and an expense.
const ITEMS = [
  { code: 'TEA-500', name: 'Assam Tea 500 g', category: 'Grocery', sellPrice: 236, mrp: 250, taxRate: 5, hsnCode: '0902' },
  { code: 'RICE-5K', name: 'Basmati Rice 5 kg', category: 'Grocery', sellPrice: 640, mrp: 699, taxRate: 5, hsnCode: '1006' },
  { code: 'DAL-1K', name: 'Toor Dal 1 kg', category: 'Grocery', sellPrice: 165, mrp: 180, taxRate: 5, hsnCode: '0713' },
  { code: 'OIL-1L', name: 'Sunflower Oil 1 L', category: 'Grocery', sellPrice: 145, mrp: 160, taxRate: 5, hsnCode: '1512' },
  { code: 'SOAP-100', name: 'Neem Soap 100 g', category: 'Personal Care', sellPrice: 40, mrp: 45, taxRate: 18, hsnCode: '3401' },
  { code: 'SHAMP-200', name: 'Herbal Shampoo 200 ml', category: 'Personal Care', sellPrice: 180, mrp: 199, taxRate: 18, hsnCode: '3305' },
  { code: 'PASTE-150', name: 'Toothpaste 150 g', category: 'Personal Care', sellPrice: 95, mrp: 105, taxRate: 18, hsnCode: '3306' },
  { code: 'BISC-200', name: 'Butter Biscuits 200 g', category: 'Snacks', sellPrice: 35, mrp: 40, taxRate: 18, hsnCode: '1905' },
  { code: 'CHIPS-90', name: 'Salted Chips 90 g', category: 'Snacks', sellPrice: 20, mrp: 20, taxRate: 12, hsnCode: '2005' },
  { code: 'JUICE-1L', name: 'Mango Juice 1 L', category: 'Beverages', sellPrice: 110, mrp: 120, taxRate: 12, hsnCode: '2009' },
  { code: 'COLA-750', name: 'Cola 750 ml', category: 'Beverages', sellPrice: 40, mrp: 40, taxRate: 28, hsnCode: '2202' },
  { code: 'WATER-1L', name: 'Mineral Water 1 L', category: 'Beverages', sellPrice: 20, mrp: 20, taxRate: 18, hsnCode: '2201' }
];

export async function openDemoShop(request: APIRequestContext) {
  const { token, branch } = await openShop(request);
  const existing: Array<{ id: string; code: string }> = await call(request, 'GET', '/items', token);
  if (existing.some((item) => item.code === ITEMS[0].code)) return { token, branch };

  const items = [];
  for (const [index, spec] of ITEMS.entries()) {
    const costPrice = Math.round(spec.sellPrice * 0.75);
    const item = await call(request, 'POST', '/items', token, { ...spec, costPrice, uom: 'PCS', taxMode: 'INCLUSIVE' });
    // One runs low, to show on the inventory screen.
    await call(request, 'POST', '/stock/opening', token, { branchId: branch.id, itemId: item.id, qty: index === 4 ? 3 : 24 + index * 2, costPrice });
    items.push(item);
  }
  await call(request, 'PUT', '/stock/reorder-level', token, { branchId: branch.id, itemId: items[4].id, reorderLevel: 5, reorderQty: 24 });

  const customers = [];
  for (const customer of [
    { name: 'Priya Sharma', phone: '9876543210' },
    { name: 'Rahul Verma', phone: '9812345678' },
    { name: 'Anita Desai', phone: '9898989898' }
  ]) {
    customers.push(await call(request, 'POST', '/customers', token, { branchId: branch.id, ...customer }));
  }

  await call(request, 'POST', '/suppliers', token, { name: 'Sharma Wholesale Traders', phone: '9811122233', paymentTermsDays: 15 });
  await call(request, 'POST', '/purchases', token, {
    branchId: branch.id,
    supplierName: 'Sharma Wholesale Traders',
    supplierInvoiceNo: 'SWT-1042',
    lines: [
      { itemId: items[0].id, qty: 12, unitCost: 180 },
      { itemId: items[1].id, qty: 6, unitCost: 520 }
    ]
  });

  const register = await call(request, 'POST', '/registers/open', token, { branchId: branch.id, openingBalance: 2000 });
  const walkIn = await call(request, 'GET', `/customers/walk-in/${branch.id}`, register.token);
  let cash = 2000;
  for (const [customerId, lines] of [
    [walkIn.id, [[0, 2], [7, 3]]],
    [customers[0].id, [[1, 1], [3, 2], [9, 1]]],
    [walkIn.id, [[5, 1], [6, 2]]]
  ] as const) {
    const sold = lines.map(([index, qty]) => ({ itemId: items[index].id, qty, rate: ITEMS[index].sellPrice, taxRate: ITEMS[index].taxRate, taxMode: 'INCLUSIVE' }));
    const total = sold.reduce((sum, line) => sum + line.qty * line.rate, 0);
    cash += total;
    await call(request, 'POST', '/sales/checkout', register.token, {
      branchId: branch.id,
      customerId,
      lines: sold,
      payments: [{ mode: 'CASH', amount: total }],
      idempotencyKey: randomUUID()
    });
  }
  await call(request, 'POST', '/expenses', token, { branchId: branch.id, category: 'Electricity', amount: 1850, mode: 'UPI', note: 'Shop bill' });
  await call(request, 'POST', '/registers/close', register.token, { closingBalance: cash });
  return { token, branch };
}
