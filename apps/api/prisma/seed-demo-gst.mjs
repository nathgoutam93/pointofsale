import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeSaleTotals, documentNumber, documentSeries, gstinCheckCharacter, returnLineAmounts } from '@pos/contracts';

const round2 = (value) => Math.round(value * 100) / 100;
const gstin = (state) => {
  const first14 = `${state}ABCDE1234F1Z`;
  return first14 + gstinCheckCharacter(first14);
};
const GSTINS = { KA: gstin('29'), TN: gstin('33') };
const scenarioProducts = [
  { code: 'DEMO-GST-NIL', name: 'Nil Rated Demo Supply', supplyType: 'NIL_RATED', price: 80, cost: 45, hsn: '9999', color: '#85b9dc' },
  { code: 'DEMO-GST-EXEMPT', name: 'Exempt Demo Supply', supplyType: 'EXEMPT', price: 120, cost: 65, hsn: '9998', color: '#9cc99b' },
  { code: 'DEMO-GST-NONGST', name: 'Non-GST Demo Supply', supplyType: 'NON_GST', price: 65, cost: 35, hsn: '9997', color: '#e9b581' },
  { code: 'DEMO-GST-BUNDLE', name: 'High Value Demo Bundle', supplyType: 'TAXABLE', price: 75000, cost: 50000, tax: 18, hsn: '8517', color: '#a89bde' }
];

function writeScenarioImages() {
  const directory = join(process.cwd(), 'uploads', 'items');
  mkdirSync(directory, { recursive: true });
  for (const item of scenarioProducts) {
    const label = item.code === 'DEMO-GST-BUNDLE' ? 'B2CL' : item.supplyType.replace('_', ' ');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 360" role="img" aria-label="${item.name} placeholder">
<rect width="480" height="360" fill="#f8f7f3"/><circle cx="380" cy="65" r="120" fill="${item.color}" opacity=".2"/>
<rect x="82" y="65" width="316" height="220" rx="30" fill="${item.color}"/>
<rect x="100" y="82" width="280" height="186" rx="23" fill="#fff" opacity=".92"/>
<text x="240" y="175" text-anchor="middle" font-family="Arial,sans-serif" font-size="30" font-weight="700" fill="#273238">${label}</text>
<text x="240" y="325" text-anchor="middle" font-family="Arial,sans-serif" font-size="21" font-weight="700" fill="#273238">${item.name}</text>
</svg>`;
    writeFileSync(join(directory, `${item.code.toLowerCase()}.svg`), svg);
  }
}

async function createBatches(model, rows) {
  for (let i = 0; i < rows.length; i += 200) await model.createMany({ data: rows.slice(i, i + 200) });
}

function dateAt(month, day) {
  return new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), day, 6, 30));
}

function fiscalYear(date) {
  return date.getUTCMonth() >= 3 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function filingMonths() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === 'year').value);
  const month = Number(parts.find((part) => part.type === 'month').value) - 1;
  const recent = new Date(Date.UTC(year, month - 1, 1));
  const baseStart = new Date(Date.UTC(year, month - 11, 1));
  let compEnd = new Date(Date.UTC(baseStart.getUTCFullYear(), baseStart.getUTCMonth() - 1, 1));
  while (![2, 5, 8, 11].includes(compEnd.getUTCMonth())) {
    compEnd = new Date(Date.UTC(compEnd.getUTCFullYear(), compEnd.getUTCMonth() - 1, 1));
  }
  const composition = [2, 1, 0].map((back) => new Date(Date.UTC(compEnd.getUTCFullYear(), compEnd.getUTCMonth() - back, 1)));
  return { recent, composition, regularStarts: new Date(Date.UTC(compEnd.getUTCFullYear(), compEnd.getUTCMonth() + 1, 1)) };
}

export async function enrichDemoGst(prisma, apiBaseUrl) {
  writeScenarioImages();
  const alreadySeeded = await prisma.saleInvoice.count({ where: { idempotencyKey: { startsWith: 'demo-gst-v1:' } } });
  if (alreadySeeded) {
    await prisma.branch.updateMany({ where: { code: 'MYS', gstin: null }, data: { gstin: GSTINS.KA } });
    console.log(`GST filing scenarios already present (${alreadySeeded} sales); no duplicates added.`);
    return;
  }
  const { recent, composition, regularStarts } = filingMonths();
  const summary = await prisma.$transaction(async (tx) => {
    const branches = await tx.branch.findMany({ where: { code: { in: ['MAI', 'MYS', 'CHN'] } } });
    if (branches.length !== 3) throw new Error('Seed the three demo branches first');
    const byCode = Object.fromEntries(branches.map((branch) => [branch.code, branch]));
    const admin = await tx.user.findUniqueOrThrow({ where: { username: 'admin' } });
    if (await tx.taxpayerTypeChange.count()) throw new Error('Demo GST setup needs untouched taxpayer-type history');

    await tx.businessSettings.update({ where: { id: 'default' }, data: { gstNumber: GSTINS.KA } });
    for (const branch of branches) {
      const sellerGstin = branch.code === 'CHN' ? GSTINS.TN : GSTINS.KA;
      await tx.branch.update({ where: { id: branch.id }, data: { gstin: sellerGstin } });
      await tx.saleInvoice.updateMany({
        where: { branchId: branch.id, idempotencyKey: { startsWith: 'demo-v1:' } },
        data: { sellerGstin }
      });
    }
    const effectiveFrom = (date) => new Date(date.getTime() - 5.5 * 60 * 60 * 1000);
    await tx.taxpayerTypeChange.createMany({ data: [
      { taxpayerType: 'COMPOSITION', compositionCategory: 'TRADER', effectiveDate: composition[0].toISOString().slice(0, 10), effectiveFrom: effectiveFrom(composition[0]), createdBy: admin.id, createdByName: admin.username },
      { taxpayerType: 'REGULAR', effectiveDate: regularStarts.toISOString().slice(0, 10), effectiveFrom: effectiveFrom(regularStarts), createdBy: admin.id, createdByName: admin.username }
    ] });

    const newItems = scenarioProducts.map((product) => ({
      id: randomUUID(), code: product.code, name: product.name, category: 'GST Demo Scenarios',
      uom: 'PCS', leastCount: 1, costPrice: product.cost, sellPrice: product.price,
      // MRP includes GST: never below what the customer pays.
      mrp: Math.round(product.price * (100 + (product.tax ?? 0))) / 100, taxMode: 'EXCLUSIVE', taxRate: product.tax ?? 0,
      hsnCode: product.hsn, uqc: 'PCS', supplyType: product.supplyType,
      imageUrl: `${apiBaseUrl}/uploads/items/${product.code.toLowerCase()}.svg`
    }));
    await createBatches(tx.item, newItems);
    const allItems = await tx.item.findMany({ where: { code: { startsWith: 'DEMO-' } } });
    const itemByCode = Object.fromEntries(allItems.map((item) => [item.code, item]));
    const customerByBranch = {};
    // Regular sales are made at counter 1. The composition quarter's sales are made at
    // counter 2, so they get a series of their own and stay in date order: in counter 1's
    // series they'd be numbered after the later regular sales of the same financial year.
    const countersByBranch = {};
    for (const branch of branches) {
      customerByBranch[branch.code] = await tx.customer.findFirstOrThrow({ where: { branchId: branch.id, isWalkIn: true } });
      const counter = async (number) =>
        (await tx.counter.findUnique({ where: { branchId_number: { branchId: branch.id, number } } })) ??
        (await tx.counter.create({ data: { branchId: branch.id, number, name: `Counter ${number}` } }));
      countersByBranch[branch.code] = { regular: await counter(1), composition: await counter(2) };
    }

    const invoices = [], lines = [], payments = [], receipts = [], registers = [];
    const returns = [], returnLines = [], ledgers = [];
    const stockDelta = new Map();
    const seqRows = await tx.documentSequence.findMany();
    const sequences = new Map(seqRows.map((row) => [`${row.kind}:${row.series}:${row.fiscalYear}`, row.lastSeq]));
    const receiptSequence = new Map(branches.map((branch) => [branch.id, branch.receiptSeq]));
    const registerByMonth = new Map();
    const nextDocument = (kind, series, date) => {
      const year = fiscalYear(date);
      const key = `${kind}:${series}:${year}`;
      const sequence = (sequences.get(key) ?? 0) + 1;
      sequences.set(key, sequence);
      return { number: documentNumber(series, year, sequence), series, year };
    };
    const registerFor = (branch, counter, date) => {
      const key = `${branch.code}:${counter.number}:${monthKey(date)}`;
      let register = registerByMonth.get(key);
      if (!register) {
        register = {
          id: randomUUID(), userId: admin.id, branchId: branch.id, counterId: counter.id,
          openingBalance: 2000, closingBalance: 2000, expectedCash: 2000, cashDifference: 0,
          openedAt: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 3, 30)),
          closedAt: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 18, 0)),
          createdAt: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 3, 30))
        };
        registerByMonth.set(key, register);
        registers.push(register);
      }
      return register;
    };
    const moveStock = (branch, item, qty, txnType, invoiceId, date) => {
      const key = `${branch.id}:${item.id}`;
      stockDelta.set(key, (stockDelta.get(key) ?? 0) + (txnType === 'SALE' ? -qty : qty));
      ledgers.push({ branchId: branch.id, itemId: item.id, txnType,
        qtyIn: txnType === 'SALE' ? 0 : qty, qtyOut: txnType === 'SALE' ? qty : 0,
        costPrice: item.costPrice, referenceType: txnType === 'RETURN' ? 'RETURN' : txnType === 'SALE_CANCEL' ? 'SALE_CANCEL' : 'SALE',
        referenceId: invoiceId, createdAt: date });
    };
    const addSale = ({ branch, date, key, itemLines, place, taxpayerType = 'REGULAR', cancelled = false }) => {
      const chosen = itemLines.map(([code, qty]) => {
        const item = itemByCode[code];
        if (!item) throw new Error(`Missing demo product ${code}`);
        return { item, input: { qty, rate: Number(item.sellPrice), taxMode: item.taxMode,
          taxRate: Number(item.taxRate), discounts: [] } };
      });
      const compositionSale = taxpayerType === 'COMPOSITION';
      const totals = computeSaleTotals(chosen.map((entry) => entry.input), [], 'AFTER_DISCOUNT', {
        chargeTax: !compositionSale, interState: place !== branch.stateCode
      });
      const invoiceId = randomUUID();
      const counter = countersByBranch[branch.code][compositionSale ? 'composition' : 'regular'];
      const document = nextDocument('INVOICE', documentSeries(branch.code, counter.number, 'INVOICE'), date);
      const customer = customerByBranch[branch.code];
      invoices.push({
        id: invoiceId, branchId: branch.id, invoiceNo: document.number,
        idempotencyKey: `demo-gst-v1:${key}`, customerId: customer.id, customerName: customer.name,
        status: cancelled ? 'CANCELLED' : 'SETTLED', subTotal: totals.subTotal,
        discountTotal: 0, orderDiscountAmount: 0, taxTotal: totals.taxTotal,
        cgstTotal: totals.cgstTotal, sgstTotal: totals.sgstTotal, igstTotal: totals.igstTotal,
        grandTotal: totals.grandTotal, paidTotal: cancelled ? 0 : totals.grandTotal,
        createdBy: admin.id, createdByName: admin.username,
        taxpayerType, documentType: compositionSale ? 'BILL_OF_SUPPLY' : 'TAX_INVOICE',
        compositionCategory: compositionSale ? 'TRADER' : null,
        documentSeries: document.series, fiscalYear: document.year,
        sellerGstin: branch.code === 'CHN' ? GSTINS.TN : GSTINS.KA,
        sellerStateCode: branch.stateCode, placeOfSupplyStateCode: place,
        createdAt: date
      });
      const savedLines = [];
      for (let i = 0; i < chosen.length; i += 1) {
        const item = chosen[i].item;
        const value = totals.lines[i];
        const line = {
          id: randomUUID(), invoiceId, itemId: item.id, itemName: item.name,
          qty: chosen[i].input.qty, rate: Number(item.sellPrice), listRate: Number(item.sellPrice),
          unitCost: Number(item.costPrice), discountAmount: 0,
          taxMode: 'EXCLUSIVE', taxRate: compositionSale ? 0 : Number(item.taxRate),
          taxableAmount: value.taxable, taxAmount: value.tax,
          cgstAmount: value.cgst, sgstAmount: value.sgst, igstAmount: value.igst,
          netAmount: value.net, hsnCode: item.hsnCode, uqc: item.uqc, supplyType: item.supplyType
        };
        lines.push(line);
        savedLines.push({ ...line, item });
        moveStock(branch, item, line.qty, 'SALE', invoiceId, date);
        if (cancelled) moveStock(branch, item, line.qty, 'SALE_CANCEL', invoiceId, new Date(date.getTime() + 1000));
      }
      if (!cancelled) {
        const register = registerFor(branch, counter, date);
        payments.push({ invoiceId, mode: 'CARD', amount: totals.grandTotal,
          reference: `GST-DEMO-${key}`, registerSessionId: register.id, createdAt: date });
        const receiptSeq = receiptSequence.get(branch.id) + 1;
        receiptSequence.set(branch.id, receiptSeq);
        receipts.push({ receiptNo: `RCPT-${branch.code}-${String(receiptSeq).padStart(6, '0')}`,
          invoiceId, amount: totals.grandTotal, createdAt: date });
      }
      return { invoiceId, branch, counter, lines: savedLines };
    };
    const addReturn = (sale, lineIndex, qty, date) => {
      const line = sale.lines[lineIndex];
      const refund = returnLineAmounts({
        line: { taxable: line.taxableAmount, cgst: line.cgstAmount, sgst: line.sgstAmount, igst: line.igstAmount },
        soldQty: line.qty, alreadyReturnedQty: 0,
        alreadyReturned: { taxable: 0, cgst: 0, sgst: 0, igst: 0 }, qty
      });
      // Refunded at the counter that made the sale.
      const document = nextDocument('RETURN', documentSeries(sale.branch.code, sale.counter.number, 'RETURN'), date);
      const returnId = randomUUID();
      const register = registerFor(sale.branch, sale.counter, date);
      register.expectedCash = round2(register.expectedCash - refund.amount);
      register.closingBalance = register.expectedCash;
      returns.push({ id: returnId, saleInvoiceId: sale.invoiceId, returnNo: document.number,
        documentSeries: document.series, fiscalYear: document.year,
        totalAmount: refund.amount, taxableTotal: refund.taxable, taxTotal: refund.tax,
        cgstTotal: refund.cgst, sgstTotal: refund.sgst, igstTotal: refund.igst,
        refundMode: 'CASH', registerSessionId: register.id, createdAt: date });
      returnLines.push({ returnInvoiceId: returnId, saleLineId: line.id, qty, amount: refund.amount,
        taxableAmount: refund.taxable, taxAmount: refund.tax,
        cgstAmount: refund.cgst, sgstAmount: refund.sgst, igstAmount: refund.igst });
      moveStock(sale.branch, line.item, qty, 'RETURN', returnId, date);
    };

    for (const branch of branches) {
      for (const [monthIndex, month] of composition.entries()) {
        const first = addSale({ branch, date: dateAt(month, 8), key: `composition:${branch.code}:${monthKey(month)}:a`,
          itemLines: [['DEMO-001', 2], ['DEMO-GST-EXEMPT', 1]], place: branch.stateCode, taxpayerType: 'COMPOSITION' });
        addSale({ branch, date: dateAt(month, 19), key: `composition:${branch.code}:${monthKey(month)}:b`,
          itemLines: [['DEMO-004', 2], ['DEMO-GST-NIL', 1]], place: branch.stateCode, taxpayerType: 'COMPOSITION' });
        if (monthIndex === 0) addReturn(first, 0, 1, dateAt(composition[2], 23));
      }
    }

    const main = byCode.MAI;
    addSale({ branch: main, date: dateAt(recent, 5), key: 'main:non-taxable',
      itemLines: [['DEMO-GST-NIL', 2], ['DEMO-GST-EXEMPT', 1], ['DEMO-GST-NONGST', 1]], place: '29' });
    const mainSmall = addSale({ branch: main, date: dateAt(recent, 8), key: 'main:interstate-small',
      itemLines: [['DEMO-006', 2], ['DEMO-GST-NIL', 1]], place: '27' });
    const mainLarge = addSale({ branch: main, date: dateAt(recent, 12), key: 'main:b2cl',
      itemLines: [['DEMO-GST-BUNDLE', 2], ['DEMO-006', 1]], place: '27' });
    addSale({ branch: main, date: dateAt(recent, 17), key: 'main:cancelled',
      itemLines: [['DEMO-008', 1]], place: '29', cancelled: true });
    addReturn(mainSmall, 0, 1, dateAt(recent, 19));
    addReturn(mainLarge, 1, 1, dateAt(recent, 24));

    const mys = byCode.MYS;
    addSale({ branch: mys, date: dateAt(recent, 7), key: 'mys:non-taxable',
      itemLines: [['DEMO-GST-NIL', 1], ['DEMO-GST-EXEMPT', 2]], place: '29' });
    addSale({ branch: mys, date: dateAt(recent, 14), key: 'mys:interstate-small',
      itemLines: [['DEMO-007', 2], ['DEMO-GST-NONGST', 1]], place: '33' });

    const chn = byCode.CHN;
    addSale({ branch: chn, date: dateAt(recent, 9), key: 'chn:non-taxable',
      itemLines: [['DEMO-GST-NIL', 1], ['DEMO-GST-EXEMPT', 1], ['DEMO-GST-NONGST', 1]], place: '33' });
    addSale({ branch: chn, date: dateAt(recent, 16), key: 'chn:interstate-small',
      itemLines: [['DEMO-006', 1]], place: '29' });
    const chnLarge = addSale({ branch: chn, date: dateAt(recent, 11), key: 'chn:b2cl',
      itemLines: [['DEMO-GST-BUNDLE', 2], ['DEMO-008', 1]], place: '29' });
    addReturn(chnLarge, 1, 1, dateAt(recent, 22));

    const openingDate = new Date(composition[0].getTime() - 24 * 60 * 60 * 1000);
    for (const branch of branches) {
      for (const item of newItems) {
        const qty = item.code === 'DEMO-GST-BUNDLE' ? 12 : 600;
        await tx.itemStock.create({ data: { branchId: branch.id, itemId: item.id, qty } });
        ledgers.push({ branchId: branch.id, itemId: item.id, txnType: 'OPENING',
          qtyIn: qty, qtyOut: 0, costPrice: item.costPrice,
          reason: 'Demo GST scenario opening stock', createdAt: openingDate });
      }
    }
    await createBatches(tx.registerSession, registers);
    await createBatches(tx.saleInvoice, invoices);
    await createBatches(tx.saleInvoiceLine, lines);
    await createBatches(tx.payment, payments);
    await createBatches(tx.receipt, receipts);
    await createBatches(tx.returnInvoice, returns);
    await createBatches(tx.returnInvoiceLine, returnLines);
    await createBatches(tx.stockLedger, ledgers);
    for (const [key, delta] of stockDelta) {
      const [branchId, itemId] = key.split(':');
      const stock = await tx.itemStock.update({
        where: { branchId_itemId: { branchId, itemId } }, data: { qty: { increment: delta } }
      });
      if (Number(stock.qty) < 0) throw new Error('GST scenario used more stock than available');
    }
    for (const [key, lastSeq] of sequences) {
      const [kind, series, year] = key.split(':');
      await tx.documentSequence.upsert({
        where: { kind_series_fiscalYear: { kind, series, fiscalYear: Number(year) } },
        update: { lastSeq }, create: { kind, series, fiscalYear: Number(year), lastSeq }
      });
    }
    for (const branch of branches) {
      await tx.branch.update({ where: { id: branch.id }, data: { receiptSeq: receiptSequence.get(branch.id) } });
    }
    return { invoices: invoices.length, returns: returns.length, showcaseMonth: monthKey(recent),
      compositionQuarter: `${monthKey(composition[0])} to ${monthKey(composition[2])}` };
  }, { timeout: 120000 });
  console.log(`Added GST filing fixtures: ${summary.invoices} invoices, ${summary.returns} credit notes; regular ${summary.showcaseMonth}, composition ${summary.compositionQuarter}.`);
  console.log(`Demo GSTINs: Karnataka ${GSTINS.KA}, Tamil Nadu ${GSTINS.TN}`);
}
