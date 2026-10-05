import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { computeSaleTotals, documentNumber, documentSeries, resolveDiscountAmounts } from '@pos/contracts';
import { enrichDemoGst } from './seed-demo-gst.mjs';

const round2 = (value) => Math.round(value * 100) / 100;

const envPath = join(process.cwd(), '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/pos_pr_auth_test') {
  throw new Error('Demo seed is restricted to the isolated pos_pr_auth_test database');
}

const prisma = new PrismaClient();
const apiBaseUrl = process.env.DEMO_API_BASE_URL ?? 'http://localhost:3001';
const products = [
  { code: 'DEMO-001', name: 'Basmati Rice 5 kg', category: 'Groceries', cost: 340, price: 499, tax: 5, hsn: '1006', color: '#e9b44c', symbol: 'RICE' },
  { code: 'DEMO-002', name: 'Whole Wheat Flour 5 kg', category: 'Groceries', cost: 210, price: 299, tax: 5, hsn: '1101', color: '#d7a86e', symbol: 'FLOUR' },
  { code: 'DEMO-003', name: 'Sunflower Oil 1 L', category: 'Groceries', cost: 115, price: 169, tax: 5, hsn: '1512', color: '#f3c95c', symbol: 'OIL' },
  { code: 'DEMO-004', name: 'Masala Tea 250 g', category: 'Beverages', cost: 110, price: 179, tax: 5, hsn: '0902', color: '#9c6b4b', symbol: 'TEA' },
  { code: 'DEMO-005', name: 'Filter Coffee 200 g', category: 'Beverages', cost: 185, price: 279, tax: 5, hsn: '0901', color: '#805845', symbol: 'COFFEE' },
  { code: 'DEMO-006', name: 'Dish Wash Liquid 500 ml', category: 'Home Care', cost: 70, price: 119, tax: 18, hsn: '3402', color: '#4ca6a8', symbol: 'DISH' },
  { code: 'DEMO-007', name: 'Laundry Detergent 1 kg', category: 'Home Care', cost: 125, price: 199, tax: 18, hsn: '3402', color: '#6a94c7', symbol: 'WASH' },
  { code: 'DEMO-008', name: 'A5 Ruled Notebook', category: 'Stationery', cost: 48, price: 89, tax: 12, hsn: '4820', color: '#c786a3', symbol: 'NOTES' },
  { code: 'DEMO-009', name: 'Ceramic Coffee Mug', category: 'Homeware', cost: 105, price: 199, tax: 12, hsn: '6912', color: '#b58bcb', symbol: 'MUG' },
  { code: 'DEMO-010', name: 'Reusable Cotton Tote', category: 'Homeware', cost: 95, price: 179, tax: 12, hsn: '4202', color: '#86ad7d', symbol: 'TOTE' }
];
const branchSpecs = [
  // MAI is the branch the API creates at first start; the seed takes it over.
  { code: 'MAI', name: 'Everyday Market Bengaluru', stateCode: '29' },
  { code: 'MYS', name: 'Everyday Market Mysuru', stateCode: '29' },
  { code: 'CHN', name: 'Everyday Market Chennai', stateCode: '33' }
];
const customerNames = ['Aarav Mehta', 'Maya Rao', 'Neha Shah', 'Kabir Iyer'];
const now = new Date();
const localNow = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
}).formatToParts(now);
const part = (kind) => Number(localNow.find((entry) => entry.type === kind)?.value);
const currentYear = part('year');
const currentMonth = part('month') - 1;
const currentDay = part('day');

function placeholderSvg(product) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 360" role="img" aria-label="${product.name} placeholder">
<rect width="480" height="360" fill="#f8f7f3"/><circle cx="390" cy="58" r="112" fill="${product.color}" opacity=".17"/>
<circle cx="70" cy="315" r="116" fill="${product.color}" opacity=".15"/>
<rect x="128" y="55" width="224" height="232" rx="28" fill="${product.color}"/>
<rect x="145" y="75" width="190" height="192" rx="19" fill="#fff" opacity=".91"/>
<circle cx="240" cy="158" r="49" fill="${product.color}" opacity=".22"/>
<text x="240" y="171" text-anchor="middle" font-family="Arial,sans-serif" font-size="27" font-weight="700" fill="#263238">${product.symbol}</text>
<text x="240" y="326" text-anchor="middle" font-family="Arial,sans-serif" font-size="22" font-weight="700" fill="#263238">${product.name}</text>
</svg>`;
}

function writePlaceholders() {
  const directory = join(process.cwd(), 'uploads', 'items');
  mkdirSync(directory, { recursive: true });
  for (const product of products) {
    writeFileSync(join(directory, `${product.code.toLowerCase()}.svg`), placeholderSvg(product));
  }
}

function dateInMonth(year, month, index, count, current) {
  if (current) {
    const day = Math.max(1, currentDay - (count - 1 - index));
    const date = new Date(Date.UTC(year, month, day, 7 + index, 30));
    return new Date(Math.min(date.getTime(), now.getTime() - 60 * 60 * 1000));
  }
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = 2 + Math.floor(((index + 0.5) * (days - 3)) / count);
  return new Date(Date.UTC(year, month, day, 5 + (index % 10), (index * 17) % 60));
}

function fiscalYear(year, month) {
  return month >= 3 ? year : year - 1;
}

async function createManyInBatches(model, rows) {
  for (let offset = 0; offset < rows.length; offset += 200) {
    await model.createMany({ data: rows.slice(offset, offset + 200) });
  }
}

async function seed() {
  writePlaceholders();
  const existingDemo = await prisma.saleInvoice.count({ where: { idempotencyKey: { startsWith: 'demo-v1:' } } });
  if (existingDemo) {
    const walkIns = await prisma.customer.findMany({ where: { isWalkIn: true }, select: { id: true, branchId: true } });
    for (const walkIn of walkIns) {
      await prisma.walletAccount.upsert({
        where: { customerId: walkIn.id }, update: {},
        create: { customerId: walkIn.id, branchId: walkIn.branchId, balance: 0 }
      });
    }
    console.log(`Demo data already present (${existingDemo} sales); no duplicate records added.`);
    return;
  }
  const [existingSales, existingItems, admin] = await Promise.all([
    prisma.saleInvoice.count(),
    prisma.item.count(),
    prisma.user.findUnique({ where: { username: 'admin' } })
  ]);
  if (existingSales || existingItems || !admin) {
    throw new Error('Expected a fresh local PR database with its first admin and no products or sales');
  }

  const summary = await prisma.$transaction(async (tx) => {
    const branches = [];
    for (const spec of branchSpecs) {
      const data = { name: spec.name, stateCode: spec.stateCode };
      const branch = await tx.branch.upsert({
        where: { code: spec.code },
        update: data,
        create: { ...data, code: spec.code, receiptPrefix: 'RCPT' }
      });
      // Registers run on a counter; a branch made here starts with counter 1, like the API's.
      // Its sales are numbered in that counter's series (MAI/1/26/00001).
      branch.counter =
        (await tx.counter.findUnique({ where: { branchId_number: { branchId: branch.id, number: 1 } } })) ??
        (await tx.counter.create({ data: { branchId: branch.id, number: 1, name: 'Counter 1' } }));
      branch.invoiceSeries = documentSeries(branch.code, branch.counter.number, 'INVOICE');
      branches.push(branch);
      await tx.userBranchAccess.upsert({
        where: { userId_branchId: { userId: admin.id, branchId: branch.id } },
        update: {}, create: { userId: admin.id, branchId: branch.id }
      });
    }
    await tx.businessSettings.update({
      where: { id: 'default' },
      data: { name: 'Everyday Market (Demo)', timezone: 'Asia/Kolkata', customerScope: 'SHARED' }
    });

    const customersByBranch = [];
    const customerRows = [];
    const walletRows = [];
    for (const branch of branches) {
      let walkIn = await tx.customer.findFirst({ where: { branchId: branch.id, isWalkIn: true } });
      if (!walkIn) {
        walkIn = await tx.customer.create({
          data: { branchId: branch.id, code: `CUST-${branch.code}-000001`, name: 'Walk In Customer', isWalkIn: true }
        });
      }
      await tx.walletAccount.upsert({
        where: { customerId: walkIn.id }, update: {},
        create: { customerId: walkIn.id, branchId: branch.id, balance: 0 }
      });
      const named = [];
      for (let index = 0; index < customerNames.length; index += 1) {
        const id = randomUUID();
        named.push({ id, name: customerNames[index] });
        customerRows.push({ id, branchId: branch.id, code: `CUST-${branch.code}-${String(index + 2).padStart(6, '0')}`, name: customerNames[index] });
        walletRows.push({ customerId: id, branchId: branch.id, balance: 0 });
      }
      customersByBranch.push({ walkIn, named });
      await tx.branch.update({ where: { id: branch.id }, data: { customerSeq: customerNames.length + 1 } });
    }
    await createManyInBatches(tx.customer, customerRows);
    await createManyInBatches(tx.walletAccount, walletRows);

    const items = [];
    for (const product of products) {
      items.push({
        id: randomUUID(), code: product.code, name: product.name, category: product.category,
        uom: 'PCS', leastCount: 1, costPrice: product.cost, sellPrice: product.price,
        // MRP includes GST: never below what the customer pays.
        mrp: Math.round(product.price * (100 + product.tax)) / 100, taxMode: 'EXCLUSIVE', taxRate: product.tax,
        hsnCode: product.hsn, uqc: 'PCS', supplyType: 'TAXABLE',
        imageUrl: `${apiBaseUrl}/uploads/items/${product.code.toLowerCase()}.svg`
      });
    }
    await createManyInBatches(tx.item, items);

    const invoices = [], lines = [], discounts = [], allocations = [];
    const payments = [], receipts = [], ledgers = [], registers = [], stocks = [];
    const documentSequences = new Map();
    let saleCount = 0;
    let grandTotal = 0;
    const firstMonth = new Date(Date.UTC(currentYear, currentMonth - 11, 1));
    const openingDate = new Date(firstMonth.getTime() - 24 * 60 * 60 * 1000);

    for (let branchIndex = 0; branchIndex < branches.length; branchIndex += 1) {
      const branch = branches[branchIndex];
      const customers = customersByBranch[branchIndex];
      const soldByItem = new Map(items.map((item) => [item.id, 0]));
      let receiptSeq = 0;
      for (let monthOffset = 0; monthOffset < 12; monthOffset += 1) {
        const calendar = new Date(Date.UTC(currentYear, currentMonth - 11 + monthOffset, 1));
        const year = calendar.getUTCFullYear();
        const month = calendar.getUTCMonth();
        const isCurrent = monthOffset === 11;
        const count = isCurrent ? 3 : 12;
        const registerId = randomUUID();
        const openedAt = new Date(Date.UTC(year, month, 1, 3, 30));
        let cashTaken = 0;
        registers.push({
          id: registerId, userId: admin.id, branchId: branch.id, counterId: branch.counter.id,
          openingBalance: 2000, closingBalance: 2000, expectedCash: 2000,
          cashDifference: 0, openedAt, closedAt: isCurrent ? new Date(now.getTime() - 30 * 60 * 1000) : new Date(Date.UTC(year, month + 1, 0, 18, 0)),
          createdAt: openedAt
        });
        for (let saleIndex = 0; saleIndex < count; saleIndex += 1) {
          const serial = saleCount++;
          const createdAt = dateInMonth(year, month, saleIndex, count, isCurrent);
          const fy = fiscalYear(year, month);
          const sequenceKey = `${branch.invoiceSeries}:${fy}`;
          const nextSequence = (documentSequences.get(sequenceKey) ?? 0) + 1;
          documentSequences.set(sequenceKey, nextSequence);
          const invoiceId = randomUUID();
          const chosenCustomer = saleIndex % 4 === 0 ? customers.named[(monthOffset + saleIndex) % customers.named.length] : customers.walkIn;
          const lineInputs = [];
          const chosenItems = new Set();
          const lineCount = 1 + ((saleIndex + monthOffset + branchIndex) % 3);
          for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
            let productIndex = (monthOffset * 7 + saleIndex * 3 + branchIndex + lineIndex * 4) % items.length;
            while (chosenItems.has(productIndex)) productIndex = (productIndex + 1) % items.length;
            chosenItems.add(productIndex);
            const item = items[productIndex];
            const qty = 1 + ((saleIndex + lineIndex + monthOffset) % 3);
            lineInputs.push({
              itemId: item.id, itemName: item.name, qty, rate: Number(item.sellPrice),
              listRate: Number(item.sellPrice), unitCost: Number(item.costPrice),
              taxMode: item.taxMode, taxRate: Number(item.taxRate),
              hsnCode: item.hsnCode, uqc: item.uqc, supplyType: item.supplyType,
              discounts: serial % 8 === 0 && lineIndex === 0 ? [{ type: 'PERCENTAGE', value: 5 }] : []
            });
            soldByItem.set(item.id, soldByItem.get(item.id) + qty);
            ledgers.push({
              branchId: branch.id, itemId: item.id, txnType: 'SALE',
              qtyIn: 0, qtyOut: qty, costPrice: item.costPrice,
              referenceType: 'SALE', referenceId: invoiceId, createdAt
            });
          }
          const orderDiscounts = serial % 13 === 0 ? [{ type: 'PERCENTAGE', value: 3 }] : [];
          const totals = computeSaleTotals(lineInputs, orderDiscounts, { chargeTax: true, interState: false });
          grandTotal = round2(grandTotal + totals.grandTotal);
          const invoiceNo = documentNumber(branch.invoiceSeries, fy, nextSequence);
          invoices.push({
            id: invoiceId, branchId: branch.id, invoiceNo,
            idempotencyKey: `demo-v1:${branch.code}:${year}-${String(month + 1).padStart(2, '0')}:${saleIndex}`,
            customerId: chosenCustomer.id, customerName: chosenCustomer.name,
            status: 'SETTLED', subTotal: totals.subTotal, discountTotal: totals.discountTotal,
            orderDiscountAmount: totals.orderDiscountTotal, taxTotal: totals.taxTotal,
            cgstTotal: totals.cgstTotal, sgstTotal: totals.sgstTotal, igstTotal: totals.igstTotal,
            grandTotal: totals.grandTotal, paidTotal: totals.grandTotal,
            createdBy: admin.id, createdByName: admin.username,
            taxpayerType: 'REGULAR', documentType: 'TAX_INVOICE',
            documentSeries: branch.invoiceSeries, fiscalYear: fy,
            sellerStateCode: branch.stateCode, placeOfSupplyStateCode: branch.stateCode,
            createdAt
          });
          const savedLineIds = [];
          for (let lineIndex = 0; lineIndex < totals.lines.length; lineIndex += 1) {
            const priced = totals.lines[lineIndex];
            const input = priced.line;
            const lineId = randomUUID();
            savedLineIds.push(lineId);
            lines.push({
              id: lineId, invoiceId, itemId: input.itemId, itemName: input.itemName,
              qty: input.qty, rate: input.rate, listRate: input.listRate, unitCost: input.unitCost,
              discountAmount: priced.discountAmount, taxMode: input.taxMode, taxRate: input.taxRate,
              taxableAmount: priced.taxable, taxAmount: priced.tax,
              cgstAmount: priced.cgst, sgstAmount: priced.sgst, igstAmount: priced.igst,
              netAmount: priced.net, hsnCode: input.hsnCode, uqc: input.uqc, supplyType: input.supplyType
            });
            for (const itemDiscount of resolveDiscountAmounts(input.discounts, priced.baseExclusive)) {
              const discountId = randomUUID();
              discounts.push({ id: discountId, saleInvoiceId: invoiceId, scope: 'ITEM', type: itemDiscount.type, value: itemDiscount.value, createdAt });
              allocations.push({ discountId, saleInvoiceLineId: lineId, amount: itemDiscount.amount });
            }
          }
          for (const orderDiscount of totals.orderDiscountPlans) {
            const discountId = randomUUID();
            discounts.push({ id: discountId, saleInvoiceId: invoiceId, scope: 'ORDER', type: orderDiscount.type, value: orderDiscount.value, createdAt });
            for (let lineIndex = 0; lineIndex < savedLineIds.length; lineIndex += 1) {
              const amount = round2(orderDiscount.allocations[lineIndex] ?? 0);
              if (amount > 0) allocations.push({ discountId, saleInvoiceLineId: savedLineIds[lineIndex], amount });
            }
          }
          receiptSeq += 1;
          receipts.push({
            receiptNo: `RCPT-${branch.code}-${String(receiptSeq).padStart(6, '0')}`,
            invoiceId, amount: totals.grandTotal, createdAt
          });
          const cashOnly = serial % 5 === 0;
          const split = serial % 11 === 0;
          if (split) {
            const cash = round2(totals.grandTotal * 0.4);
            cashTaken = round2(cashTaken + cash);
            payments.push({ invoiceId, mode: 'CASH', amount: cash, registerSessionId: registerId, createdAt });
            payments.push({ invoiceId, mode: 'CARD', amount: round2(totals.grandTotal - cash), reference: `DEMO-${receiptSeq}`, registerSessionId: registerId, createdAt });
          } else {
            if (cashOnly) cashTaken = round2(cashTaken + totals.grandTotal);
            payments.push({ invoiceId, mode: cashOnly ? 'CASH' : 'CARD', amount: totals.grandTotal,
              reference: cashOnly ? null : `DEMO-${receiptSeq}`, registerSessionId: registerId, createdAt });
          }
        }
        const register = registers[registers.length - 1];
        register.expectedCash = round2(2000 + cashTaken);
        register.closingBalance = register.expectedCash;
      }
      for (const item of items) {
        const openingQty = 600;
        const remaining = openingQty - soldByItem.get(item.id);
        if (remaining < 0) throw new Error(`Demo stock ran out for ${item.name}`);
        ledgers.push({ branchId: branch.id, itemId: item.id, txnType: 'OPENING', qtyIn: openingQty,
          qtyOut: 0, costPrice: item.costPrice, reason: 'Demo opening stock', createdAt: openingDate });
        stocks.push({ branchId: branch.id, itemId: item.id, qty: remaining });
      }
      await tx.branch.update({ where: { id: branch.id }, data: { receiptSeq } });
    }

    await createManyInBatches(tx.registerSession, registers);
    await createManyInBatches(tx.saleInvoice, invoices);
    await createManyInBatches(tx.saleInvoiceLine, lines);
    await createManyInBatches(tx.discount, discounts);
    await createManyInBatches(tx.discountAllocation, allocations);
    await createManyInBatches(tx.payment, payments);
    await createManyInBatches(tx.receipt, receipts);
    await createManyInBatches(tx.stockLedger, ledgers);
    await createManyInBatches(tx.itemStock, stocks);
    for (const [key, lastSeq] of documentSequences) {
      const [series, year] = key.split(':');
      await tx.documentSequence.create({ data: { kind: 'INVOICE', series, fiscalYear: Number(year), lastSeq } });
    }
    return { branches: branches.length, products: items.length, invoices: invoices.length,
      firstSale: invoices[0].createdAt.toISOString().slice(0, 10),
      lastSale: invoices[invoices.length - 1].createdAt.toISOString().slice(0, 10),
      grossSales: grandTotal };
  }, { timeout: 120000 });
  console.log(`Seeded ${summary.branches} branches, ${summary.products} products, ${summary.invoices} paid sales (${summary.firstSale} to ${summary.lastSale}); gross sales ₹${summary.grossSales.toFixed(2)}.`);
}

try {
  await seed();
  await enrichDemoGst(prisma, apiBaseUrl);
} finally {
  await prisma.$disconnect();
}
