import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { CustomerScope, DocumentKind, Prisma } from '@prisma/client';
import { APP_VERSION, documentSeries, FALLBACK_SYNC_CONFLICT } from '@pos/contracts';
import { randomBytes } from 'crypto';
import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { hashPassword, verifyPassword } from '../auth/password';
import { createBackup, appliedSchemaVersion } from '../backup/local-backup';
import { lockBranchRegisters } from '../common/counters';
import type { SessionUser } from '../common/types';
import { uploadsDir } from '../common/uploads';
import { counterSelect } from '../counters/counters.service';
import { PrismaService } from '../prisma.service';
import { currentBusiness } from '../tenancy/tenant-context';
import { TenancyService } from '../tenancy/tenancy.service';
import { BranchesService } from '../branches/branches.service';
import { toNumber } from '../common/numbers';
import { RegistersService } from '../registers/registers.service';
import { SequenceService } from '../sequences/sequences.service';
import { verifyOutbox } from './verify-outbox';
import { syncConflicts, verificationContext } from './sync-checks';
import { placeBatchShortfalls } from './batch-shortfalls';
import { registerBaselineSql } from './register-baseline';
import { StockService } from '../stock/stock.service';

/** How far back the copy carries the counter's own paid bills, so their goods can be returned offline. */
export const FALLBACK_RETURNABLE_DAYS = 7;

/** Customers made offline have codes like OFF-1A2B3C4D until the server gives them one of its own. */
export const OFFLINE_CUSTOMER_CODE = /^OFF-[0-9A-F]{8}$/;

/** A fallback computer's key: fb1.<business id>.<counter id>.<secret>. Only the secret's hash is kept. */
const KEY_PATTERN = /^fb1\.([0-9a-f-]{36})\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/;
const UUID = /^[0-9a-f-]{36}$/;

/** A SQL string literal for an id (always a UUID or a document series here). */
const lit = (value: string) => {
  if (!/^[A-Za-z0-9/_-]+$/.test(value)) throw new Error(`Unexpected value ${value}`);
  return `'${value}'`;
};

/** What a fallback counter's computer sends back: everything it made while offline. */
export type FallbackOutbox = {
  schemaVersion: string;
  /** Rows as PostgreSQL's row_to_json writes them, so they load back exactly. */
  registers: Array<Record<string, unknown>>;
  invoices: Array<{
    invoice: Record<string, unknown>;
    lines: Array<Record<string, unknown>>;
    discounts: Array<Record<string, unknown>>;
    allocations: Array<Record<string, unknown>>;
    payments: Array<Record<string, unknown>>;
    receipts: Array<Record<string, unknown>>;
    ledger: Array<Record<string, unknown>>;
  }>;
  sequences: Array<{ kind: string; series: string; fiscalYear: number; lastSeq: number }>;
  receiptSeq: number;
  /** Customers added offline (code OFF-…). Missing from an older app's outbox. */
  customers?: Array<Record<string, unknown>>;
  /** Returns given offline, with their lines and stock movements. Missing from an older app's outbox. */
  returns?: Array<{
    ret: Record<string, unknown>;
    lines: Array<Record<string, unknown>>;
    ledger: Array<Record<string, unknown>>;
  }>;
};

type FallbackCounter = { id: string; branchId: string; number: number; name: string; branchCode: string };

/** One reason offline sales can't be added as they are, for a person to read. */
export type SyncConflict = { document: string; problem: string };

/**
 * The fallback counter on the online server: one counter per branch bound to one computer,
 * which keeps a local copy of what selling needs and, after working offline, sends its sales.
 */
@Injectable()
export class FallbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
    private readonly branches: BranchesService,
    private readonly registers: RegistersService,
    private readonly sequences: SequenceService,
    private readonly stock: StockService
  ) {}

  /** Makes `counterId` the branch's fallback counter on `deviceId`; answers the computer's key. */
  async designate(session: SessionUser, counterId: string, deviceId: string) {
    const business = currentBusiness();
    if (!business) throw new BadRequestException('Only on the online server');
    const found = await this.prisma.counter.findUnique({ where: { id: counterId }, select: { branchId: true, isActive: true, name: true } });
    if (!found) throw new NotFoundException('Counter not found');
    await this.branches.ensureUserHasBranchAccess(session.userId, found.branchId);
    if (!found.isActive) throw new BadRequestException(`${found.name} is inactive`);
    const secret = randomBytes(32).toString('base64url');
    const keyHash = await hashPassword(secret);
    const counter = await this.prisma.$transaction(async (tx) => {
      await lockBranchRegisters(tx, found.branchId);
      // A register open on it now runs on another computer, which would issue its numbers.
      const open = await tx.registerSession.findFirst({ where: { counterId, closedAt: null }, select: { id: true } });
      if (open) throw new BadRequestException(`Close ${found.name}'s register first, then set it up here.`);
      // One per branch, and one counter per computer.
      await tx.counter.updateMany({
        where: { OR: [{ branchId: found.branchId }, { fallbackDeviceId: deviceId }], NOT: { id: counterId } },
        data: { fallbackDeviceId: null, fallbackKeyHash: null }
      });
      return tx.counter.update({ where: { id: counterId }, data: { fallbackDeviceId: deviceId, fallbackKeyHash: keyHash }, select: counterSelect });
    });
    return { key: `fb1.${business.id}.${counterId}.${secret}`, counter };
  }

  async release(session: SessionUser, counterId: string) {
    const found = await this.prisma.counter.findUnique({ where: { id: counterId }, select: { branchId: true } });
    if (!found) throw new NotFoundException('Counter not found');
    await this.branches.ensureUserHasBranchAccess(session.userId, found.branchId);
    return this.prisma.counter.update({ where: { id: counterId }, data: { fallbackDeviceId: null, fallbackKeyHash: null }, select: counterSelect });
  }

  /** The counter a fallback key is for, with the request now in its business. */
  async authenticate(key: string | undefined): Promise<FallbackCounter> {
    const match = key ? KEY_PATTERN.exec(key) : null;
    if (!match) throw new UnauthorizedException('This computer is no longer the fallback counter. Set it up again in Settings → Counters.');
    const [, businessId, counterId, secret] = match;
    await this.tenancy.enterById(businessId);
    const counter = await this.prisma.counter.findUnique({
      where: { id: counterId },
      select: { id: true, branchId: true, number: true, name: true, fallbackKeyHash: true, branch: { select: { code: true } } }
    });
    if (!counter?.fallbackKeyHash || !(await verifyPassword(secret, counter.fallbackKeyHash))) {
      throw new UnauthorizedException('This computer is no longer the fallback counter. Set it up again in Settings → Counters.');
    }
    return { id: counter.id, branchId: counter.branchId, number: counter.number, name: counter.name, branchCode: counter.branch.code };
  }

  /**
   * The local copy for the counter's computer, in the local backup format (its restore tool
   * loads it): settings, the branch, its counters and staff, customers, items, prices, stock,
   * the counter's invoice and return series and its open register. No sales history, except the
   * counter's own paid bills of the last few days (with their returns), so their goods can be
   * returned offline; those are listed in FallbackCopiedDocument. FallbackBalance has what each
   * customer owed, for credit limits offline. Returns the file.
   */
  async snapshot(counter: FallbackCounter) {
    const settings = await this.prisma.businessSettings.findUnique({ where: { id: 'default' }, select: { customerScope: true, logoUrl: true } });
    const branch = await this.prisma.branch.findUniqueOrThrow({ where: { id: counter.branchId }, select: { logoUrl: true } });
    const branchId = lit(counter.branchId);
    const staff = `SELECT "userId" FROM "UserBranchAccess" WHERE "branchId" = ${branchId}`;
    const invoiceSeries = lit(documentSeries(counter.branchCode, counter.number, DocumentKind.INVOICE));
    const returnSeries = lit(documentSeries(counter.branchCode, counter.number, DocumentKind.RETURN));
    // The counter's own bills, paid in full, of the last few days: nothing about them can change
    // online except another return, which the server checks for when the offline ones come back.
    const ownBills = `SELECT "id" FROM "SaleInvoice" WHERE "branchId" = ${branchId} AND "documentSeries" = ${invoiceSeries}
      AND "status" = 'SETTLED' AND "createdAt" > now() - interval '${FALLBACK_RETURNABLE_DAYS} days'`;
    const ownReturns = `SELECT "id" FROM "ReturnInvoice" WHERE "saleInvoiceId" IN (${ownBills})`;
    const customerScope = settings?.customerScope === CustomerScope.BRANCH ? `"branchId" = ${branchId}` : undefined;
    const only = [
      { name: 'BusinessSettings' },
      { name: 'TaxpayerTypeChange' },
      { name: 'Branch' },
      { name: 'Counter', where: `"branchId" = ${branchId}` },
      {
        name: 'DocumentSequence',
        where: `("kind" = 'INVOICE' AND "series" = ${invoiceSeries}) OR ("kind" = 'RETURN' AND "series" = ${returnSeries})`
      },
      { name: 'User', where: `"id" IN (${staff})` },
      { name: 'UserBranchAccess', where: `"userId" IN (${staff})` },
      { name: 'Customer', where: customerScope },
      {
        name: 'FallbackBalance',
        from: `SELECT "customerId", SUM(GREATEST("grandTotal" - "paidTotal" - "creditedTotal", 0))::numeric(14, 2) AS "owed"
          FROM "SaleInvoice" WHERE "status" IN ('DRAFT', 'PARTIALLY_SETTLED')
          ${customerScope ? `AND "customerId" IN (SELECT "id" FROM "Customer" WHERE ${customerScope})` : ''}
          GROUP BY "customerId" HAVING SUM(GREATEST("grandTotal" - "paidTotal" - "creditedTotal", 0)) > 0`
      },
      { name: 'SaleInvoice', where: `"id" IN (${ownBills})` },
      { name: 'SaleInvoiceLine', where: `"invoiceId" IN (${ownBills})` },
      { name: 'ReturnInvoice', where: `"id" IN (${ownReturns})` },
      { name: 'ReturnInvoiceLine', where: `"returnInvoiceId" IN (${ownReturns})` },
      { name: 'FallbackCopiedDocument', from: `${ownBills} UNION ALL ${ownReturns}` },
      { name: 'ItemGroup' },
      { name: 'Item' },
      { name: 'ItemBatch' },
      { name: 'BatchStock', where: `"branchId" = ${branchId}` },
      { name: 'StockLedger', where: `"referenceId" IN (${ownBills}) OR "referenceId" IN (${ownReturns})` },
      { name: 'ItemSaleUom' },
      { name: 'ItemBarcode' },
      { name: 'ItemBranchPrice', where: `"branchId" = ${branchId}` },
      { name: 'ItemStock', where: `"branchId" = ${branchId}` },
      { name: 'RegisterSession', where: `"counterId" = ${lit(counter.id)} AND "closedAt" IS NULL` },
      { name: 'FallbackRegisterBalance', from: registerBaselineSql(counter.id) }
    ];
    // The logos, for printed receipts.
    const uploadFiles = [settings?.logoUrl, branch.logoUrl]
      .filter((url): url is string => !!url && url.startsWith('/uploads/') && !url.includes('..'))
      .map((url) => url.slice('/uploads/'.length));
    const dir = await mkdtemp(join(tmpdir(), 'pos-fallback-copy-'));
    const file = await createBackup({
      prisma: this.prisma,
      dir,
      uploadsDir,
      reason: 'fallback-copy',
      appVersion: APP_VERSION,
      only,
      uploadFiles
    });
    return { file, dir };
  }

  /**
   * Takes what the counter's computer made offline, as it was made: registers, invoices (with
   * lines, discounts, payments and receipts) and their stock movements. Keyed by id, so sending
   * the same rows again changes nothing. Its invoice series and receipt count move up to the
   * numbers it used.
   */
  async sync(counter: FallbackCounter, outbox: FallbackOutbox) {
    const schemaVersion = await appliedSchemaVersion(this.prisma);
    if (outbox.schemaVersion !== schemaVersion) {
      throw new ConflictException(
        outbox.schemaVersion < (schemaVersion ?? '')
          ? 'The server has been updated. Update this app (it updates itself), then send the offline sales again.'
          : "The server hasn't been updated to this app's version yet. Try again later; the sales stay on this computer."
      );
    }
    const invoiceSeries = documentSeries(counter.branchCode, counter.number, DocumentKind.INVOICE);
    const returnSeries = documentSeries(counter.branchCode, counter.number, DocumentKind.RETURN);
    const customers = outbox.customers ?? [];
    const returns = outbox.returns ?? [];
    const registerIds = new Set(outbox.registers.map((row) => String(row.id)));
    const outboxInvoiceIds = new Set(outbox.invoices.map((entry) => String(entry.invoice.id)));
    const fail = (what: string) => {
      throw new ForbiddenException(`Offline sales from this computer can't include ${what}`);
    };
    for (const register of outbox.registers) {
      if (register.counterId !== counter.id || register.branchId !== counter.branchId) fail("another counter's register");
    }
    for (const entry of outbox.invoices) {
      if (entry.invoice.branchId !== counter.branchId || entry.invoice.documentSeries !== invoiceSeries) fail("another counter's invoice");
      for (const payment of entry.payments) {
        if (payment.invoiceId !== entry.invoice.id) fail('a payment of another invoice');
        if (payment.registerSessionId && !registerIds.has(String(payment.registerSessionId))) fail("a payment on another counter's register");
      }
      for (const row of [...entry.lines, ...entry.discounts, ...entry.receipts]) {
        const owner = row.invoiceId ?? row.saleInvoiceId;
        if (owner !== entry.invoice.id) fail('a row of another invoice');
      }
      for (const row of entry.ledger) {
        if (row.branchId !== counter.branchId || row.referenceId !== entry.invoice.id || row.referenceType !== 'SALE') fail('other stock movements');
      }
    }
    for (const customer of customers) {
      if (customer.branchId !== counter.branchId || customer.isWalkIn !== false || !OFFLINE_CUSTOMER_CODE.test(String(customer.code))) {
        fail('a customer not added offline at this branch');
      }
    }
    for (const entry of returns) {
      if (entry.ret.documentSeries !== returnSeries) fail("another counter's return");
      if (!registerIds.has(String(entry.ret.registerSessionId))) fail("a return on another counter's register");
      for (const row of entry.lines) if (row.returnInvoiceId !== entry.ret.id) fail('a line of another return');
      for (const row of entry.ledger) {
        if (row.branchId !== counter.branchId || row.referenceId !== entry.ret.id || row.referenceType !== 'RETURN') fail('other stock movements');
      }
    }
    for (const sequence of outbox.sequences) {
      const ok = (sequence.kind === 'INVOICE' && sequence.series === invoiceSeries) || (sequence.kind === 'RETURN' && sequence.series === returnSeries);
      if (!ok) fail("another series' numbers");
    }

    const rows = (name: string, list: Array<Record<string, unknown>>) => ({ name, list });
    const insert = async (tx: Prisma.TransactionClient, table: { name: string; list: Array<Record<string, unknown>> }) => {
      if (table.list.length === 0) return 0;
      return tx.$executeRawUnsafe(
        `INSERT INTO "${table.name}" SELECT * FROM json_populate_recordset(NULL::"${table.name}", $1::json) ON CONFLICT ("id") DO NOTHING`,
        JSON.stringify(table.list)
      );
    };

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await lockBranchRegisters(tx, counter.branchId);
          const touchedBills = [...new Set([...outbox.invoices.map((entry) => String(entry.invoice.id)), ...returns.map((entry) => String(entry.ret.saleInvoiceId))])].sort();
          await tx.$queryRaw`SELECT id FROM "SaleInvoice" WHERE id = ANY(${touchedBills}::text[]) ORDER BY id FOR UPDATE`;
          await this.stock.lockItemStock(tx, counter.branchId, [...outbox.invoices.flatMap((entry) => entry.ledger), ...returns.flatMap((entry) => entry.ledger)].map((row) => String(row.itemId)));
          const reconcileRegisters = new Set(outbox.registers.filter((row) => row.closedAt).map((row) => String(row.id)));
          // A return offline is of a bill made offline, or of one of the counter's own that came with the copy.
          const returnedBills = [...new Set(returns.map((entry) => String(entry.ret.saleInvoiceId)))].filter((id) => !outboxInvoiceIds.has(id));
          const serverBills = await tx.saleInvoice.findMany({ where: { id: { in: returnedBills } }, select: { id: true, documentSeries: true } });
          if (serverBills.length !== returnedBills.length || serverBills.some((bill) => bill.documentSeries !== invoiceSeries)) {
            fail("a return of another counter's bill");
          }
          const { invoices: withCustomers, created } = await this.placeCustomers(tx, counter, customers, outbox.invoices);
          // Batches another till emptied meanwhile: the rest of the sale is counted without a batch.
          const { invoices: placed, returns: placedReturns, shortfalls } = await placeBatchShortfalls(tx, withCustomers, returns);
          const conflicts = [
            ...(await syncConflicts(tx, { ...outbox, invoices: placed, returns: placedReturns }, new Set(created.map((row) => String(row.id))))),
            // The money, stock and returns worked out again: the rows come from a computer in the shop.
            ...verifyOutbox({ ...outbox, invoices: placed, returns: placedReturns }, await verificationContext(tx, outbox, placedReturns))
          ];
          if (conflicts.length) {
            throw new ConflictException({
              statusCode: 409,
              code: FALLBACK_SYNC_CONFLICT,
              message: `The offline sales clash with the server in ${conflicts.length === 1 ? 'one place' : `${conflicts.length} places`}. Nothing was added; they stay on this computer.`,
              conflicts
            });
          }
          if (outbox.registers.length) {
            // A register opened offline when the copy didn't have the one open online (opened
            // after the copy's last refresh): that one ended when the offline one began.
            const known = new Set(
              (await tx.registerSession.findMany({ where: { id: { in: [...registerIds] } }, select: { id: true } })).map((row) => row.id)
            );
            // Its cash is worked out as at close; nobody counted it, so the count stays empty.
            for (const register of outbox.registers.filter((row) => !known.has(String(row.id)))) {
              const closedAt = new Date(String(register.openedAt));
              const replaced = await tx.registerSession.findMany({
                where: { counterId: counter.id, closedAt: null, id: { notIn: [...registerIds] }, openedAt: { lt: closedAt } },
                select: { id: true }
              });
              // Its expected cash is worked out with the others below, once the offline rows are in.
              for (const open of replaced) {
                reconcileRegisters.add(open.id);
                await tx.registerSession.update({ where: { id: open.id }, data: { closedAt } });
              }
            }
            // A register opened offline is added; one closed offline is closed here too.
            await tx.$executeRawUnsafe(
              `INSERT INTO "RegisterSession" SELECT * FROM json_populate_recordset(NULL::"RegisterSession", $1::json)
               ON CONFLICT ("id") DO UPDATE SET "closingBalance" = EXCLUDED."closingBalance", "expectedCash" = EXCLUDED."expectedCash",
                 "cashDifference" = EXCLUDED."cashDifference", "closedAt" = EXCLUDED."closedAt"
               WHERE "RegisterSession"."closedAt" IS NULL`,
              JSON.stringify(outbox.registers)
            );
          }
          // Customers added offline get the server's next customer code, and a wallet.
          for (const row of created) {
            const seq = await this.sequences.nextSequence(counter.branchId, 'customer', tx);
            await tx.customer.create({
              data: {
                id: String(row.id),
                branchId: counter.branchId,
                code: `CUST-${seq.branchCode}-${String(seq.seq).padStart(6, '0')}`,
                name: String(row.name),
                phone: (row.phone as string | null) ?? null,
                gstin: (row.gstin as string | null) ?? null,
                address: (row.address as string | null) ?? null,
                email: (row.email as string | null) ?? null,
                creditLimit: (row.creditLimit as string | number | null) ?? null,
                paymentTermsDays: (row.paymentTermsDays as number | null) ?? null,
                createdAt: new Date(String(row.createdAt))
              }
            });
            await tx.walletAccount.create({ data: { customerId: String(row.id), branchId: counter.branchId, balance: 0 } });
          }
          const all = (pick: (entry: FallbackOutbox['invoices'][number]) => Array<Record<string, unknown>>) => placed.flatMap(pick);
          // An older copy's bills have no creditedTotal.
          const invoices = await insert(tx, rows('SaleInvoice', placed.map((entry) => ({ creditedTotal: 0, ...entry.invoice }))));
          await insert(tx, rows('SaleInvoiceLine', all((entry) => entry.lines)));
          await insert(tx, rows('Discount', all((entry) => entry.discounts)));
          await insert(tx, rows('DiscountAllocation', all((entry) => entry.allocations)));
          await insert(tx, rows('Payment', all((entry) => entry.payments)));
          await insert(tx, rows('Receipt', all((entry) => entry.receipts)));
          const addedReturns = await insert(tx, rows('ReturnInvoice', returns.map((entry) => ({ roundOff: 0, ...entry.ret }))));
          await insert(tx, rows('ReturnInvoiceLine', returns.flatMap((entry) => entry.lines)));
          const ledger = [...all((entry) => entry.ledger), ...placedReturns.flatMap((entry) => entry.ledger)];
          if (ledger.length) {
            // Stock moves only for movements not already recorded.
            await tx.$executeRawUnsafe(
              `WITH added AS (
                 INSERT INTO "StockLedger" SELECT * FROM json_populate_recordset(NULL::"StockLedger", $1::json)
                 ON CONFLICT ("id") DO NOTHING RETURNING "id", "branchId", "itemId", "batchId", "qtyIn" - "qtyOut" AS change
               ), totals AS (SELECT "branchId", "itemId", SUM(change) AS change FROM added GROUP BY 1, 2),
               stock AS (
                 INSERT INTO "ItemStock" ("branchId", "itemId", "qty", "updatedAt")
                 SELECT "branchId", "itemId", change, now() FROM totals
                 ON CONFLICT ("branchId", "itemId") DO UPDATE SET "qty" = "ItemStock"."qty" + EXCLUDED."qty", "updatedAt" = now()
                 RETURNING 1
               ), batch_totals AS (
                 SELECT "branchId", "batchId", SUM(change) AS change FROM added WHERE "batchId" IS NOT NULL GROUP BY 1, 2
               )
               INSERT INTO "BatchStock" ("branchId", "batchId", "qty", "updatedAt")
               SELECT "branchId", "batchId", change, now() FROM batch_totals
               ON CONFLICT ("branchId", "batchId") DO UPDATE SET "qty" = "BatchStock"."qty" + EXCLUDED."qty", "updatedAt" = now()`,
              JSON.stringify(ledger)
            );
          }
          // Flagged for the admin: the batch's stock and the item's count need checking.
          for (const short of shortfalls) {
            await tx.auditEvent.create({
              data: {
                userId: short.userId,
                userName: short.userName,
                action: 'OFFLINE_BATCH_SHORT',
                entityType: 'ItemBatch',
                entityId: short.batchId,
                branchId: short.branchId,
                summary: `Offline sales took ${short.qty} more from batch ${short.batchNo} than it had (another till sold them meanwhile); counted as stock without a batch. Count the item and correct its stock.`,
                details: { itemId: short.itemId, batchNo: short.batchNo, qty: short.qty }
              }
            });
          }
          for (const sequence of outbox.sequences) {
            await tx.$executeRaw`
              INSERT INTO "DocumentSequence" ("kind", "series", "fiscalYear", "lastSeq")
              VALUES (${sequence.kind}::"DocumentKind", ${sequence.series}, ${sequence.fiscalYear}, ${sequence.lastSeq})
              ON CONFLICT ("kind", "series", "fiscalYear") DO UPDATE SET "lastSeq" = GREATEST("DocumentSequence"."lastSeq", EXCLUDED."lastSeq")`;
          }
          await tx.$executeRaw`
            UPDATE "Counter" SET "fallbackReceiptSeq" = GREATEST("fallbackReceiptSeq", ${outbox.receiptSeq}) WHERE "id" = ${counter.id}`;
          // Counted cash is evidence from the till; expected cash is recomputed from all online
          // and imported transactions. Never accept an offline expected balance as authoritative.
          for (const id of reconcileRegisters) {
            const register = await tx.registerSession.findUniqueOrThrow({ where: { id } });
            const cash = await this.registers.registerCash(tx, id, toNumber(register.openingBalance));
            await tx.registerSession.update({ where: { id }, data: {
              expectedCash: cash.expectedCash,
              cashDifference: register.closingBalance === null ? null : Math.round((toNumber(register.closingBalance) - cash.expectedCash) * 100) / 100
            } });
          }
          return { invoices, registers: outbox.registers.length, customers: created.length, returns: addedReturns };
        },
        { timeout: 120_000, maxWait: 30_000 }
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError || error instanceof Prisma.PrismaClientUnknownRequestError) {
        // Something the checks above don't foresee: the database's own reason, for support.
        throw new ConflictException(
          `The offline sales couldn't be added (${error.message.split('\n').filter(Boolean).at(-1)}). They stay on this computer; save them to a file from the banner and send it to support.`
        );
      }
      throw error;
    }
  }

  /**
   * Customers added offline: one the server already has (a retry) stays as it is; one whose phone
   * number the server already has is that customer, and their offline bills are moved to them;
   * the rest are to be added. Answers the bills with their customers settled, and who to add.
   */
  private async placeCustomers(
    tx: Prisma.TransactionClient,
    counter: FallbackCounter,
    customers: Array<Record<string, unknown>>,
    invoices: FallbackOutbox['invoices']
  ) {
    if (customers.length === 0) return { invoices, created: [] as Array<Record<string, unknown>> };
    const known = new Set((await tx.customer.findMany({ where: { id: { in: customers.map((row) => String(row.id)) } }, select: { id: true } })).map((row) => row.id));
    const scope = (await tx.businessSettings.findUnique({ where: { id: 'default' }, select: { customerScope: true } }))?.customerScope;
    const sameAs = new Map<string, string>();
    const created: Array<Record<string, unknown>> = [];
    for (const row of customers.filter((customer) => !known.has(String(customer.id)))) {
      const phone = typeof row.phone === 'string' && row.phone ? row.phone : null;
      const existing = phone
        ? await tx.customer.findFirst({
            where: { phone, isWalkIn: false, ...(scope === CustomerScope.BRANCH ? { branchId: counter.branchId } : {}) },
            select: { id: true }
          })
        : null;
      if (existing) sameAs.set(String(row.id), existing.id);
      else created.push(row);
    }
    return {
      invoices: invoices.map((entry) =>
        sameAs.has(String(entry.invoice.customerId)) ? { ...entry, invoice: { ...entry.invoice, customerId: sameAs.get(String(entry.invoice.customerId)) } } : entry
      ),
      created
    };
  }

  isUuid(value: string) {
    return UUID.test(value);
  }
}
