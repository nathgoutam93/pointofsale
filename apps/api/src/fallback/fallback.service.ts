import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { CustomerScope, DocumentKind, Prisma, UserRole } from '@prisma/client';
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
import { verifyOutbox, type ServerSaleLine } from './verify-outbox';

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
    private readonly sequences: SequenceService
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
      { name: 'Item' },
      { name: 'ItemSaleUom' },
      { name: 'ItemBranchPrice', where: `"branchId" = ${branchId}` },
      { name: 'ItemStock', where: `"branchId" = ${branchId}` },
      { name: 'RegisterSession', where: `"counterId" = ${lit(counter.id)} AND "closedAt" IS NULL` }
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
          // A return offline is of a bill made offline, or of one of the counter's own that came with the copy.
          const returnedBills = [...new Set(returns.map((entry) => String(entry.ret.saleInvoiceId)))].filter((id) => !outboxInvoiceIds.has(id));
          const serverBills = await tx.saleInvoice.findMany({ where: { id: { in: returnedBills } }, select: { id: true, documentSeries: true } });
          if (serverBills.length !== returnedBills.length || serverBills.some((bill) => bill.documentSeries !== invoiceSeries)) {
            fail("a return of another counter's bill");
          }
          const { invoices: placed, created } = await this.placeCustomers(tx, counter, customers, outbox.invoices);
          const conflicts = [
            ...(await this.conflicts(tx, { ...outbox, invoices: placed, returns }, new Set(created.map((row) => String(row.id))))),
            // The money, stock and returns worked out again: the rows come from a computer in the shop.
            ...verifyOutbox({ ...outbox, invoices: placed, returns }, await this.verificationContext(tx, outbox, returns))
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
                select: { id: true, openingBalance: true }
              });
              for (const open of replaced) {
                const cash = await this.registers.registerCash(tx, open.id, toNumber(open.openingBalance));
                await tx.registerSession.update({ where: { id: open.id }, data: { closedAt, expectedCash: cash.expectedCash } });
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
          const addedReturns = await insert(tx, rows('ReturnInvoice', returns.map((entry) => entry.ret)));
          await insert(tx, rows('ReturnInvoiceLine', returns.flatMap((entry) => entry.lines)));
          const ledger = [...all((entry) => entry.ledger), ...returns.flatMap((entry) => entry.ledger)];
          if (ledger.length) {
            // Stock moves only for movements not already recorded.
            await tx.$executeRawUnsafe(
              `WITH added AS (
                 INSERT INTO "StockLedger" SELECT * FROM json_populate_recordset(NULL::"StockLedger", $1::json)
                 ON CONFLICT ("id") DO NOTHING RETURNING "branchId", "itemId", "qtyIn" - "qtyOut" AS change
               ), totals AS (SELECT "branchId", "itemId", SUM(change) AS change FROM added GROUP BY 1, 2)
               INSERT INTO "ItemStock" ("branchId", "itemId", "qty", "updatedAt")
               SELECT "branchId", "itemId", change, now() FROM totals
               ON CONFLICT ("branchId", "itemId") DO UPDATE SET "qty" = "ItemStock"."qty" + EXCLUDED."qty", "updatedAt" = now()`,
              JSON.stringify(ledger)
            );
          }
          for (const sequence of outbox.sequences) {
            await tx.$executeRaw`
              INSERT INTO "DocumentSequence" ("kind", "series", "fiscalYear", "lastSeq")
              VALUES (${sequence.kind}::"DocumentKind", ${sequence.series}, ${sequence.fiscalYear}, ${sequence.lastSeq})
              ON CONFLICT ("kind", "series", "fiscalYear") DO UPDATE SET "lastSeq" = GREATEST("DocumentSequence"."lastSeq", EXCLUDED."lastSeq")`;
          }
          await tx.$executeRaw`
            UPDATE "Counter" SET "fallbackReceiptSeq" = GREATEST("fallbackReceiptSeq", ${outbox.receiptSeq}) WHERE "id" = ${counter.id}`;
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

  /** What verifyOutbox needs from the server: the business's settings, staff roles, and bills it already had. */
  private async verificationContext(
    tx: Prisma.TransactionClient,
    outbox: FallbackOutbox,
    returns: NonNullable<FallbackOutbox['returns']>
  ) {
    const business = await tx.businessSettings.findUnique({
      where: { id: 'default' },
      select: { taxCalculationMode: true, cashierMaxDiscountPercent: true }
    });
    const staffIds = [...new Set(outbox.invoices.map((entry) => String(entry.invoice.createdBy)))];
    const admins = new Set(
      (await tx.user.findMany({ where: { id: { in: staffIds }, role: UserRole.ADMIN }, select: { id: true } })).map((user) => user.id)
    );
    const cashierLimit = toNumber(business?.cashierMaxDiscountPercent ?? 10);

    // Lines of bills the server had (the copy's), with what returns other than these took from them.
    const outboxInvoiceIds = new Set(outbox.invoices.map((entry) => String(entry.invoice.id)));
    const returnIds = returns.map((entry) => String(entry.ret.id));
    const serverBillIds = [...new Set(returns.map((entry) => String(entry.ret.saleInvoiceId)))].filter((id) => !outboxInvoiceIds.has(id));
    const serverLines = serverBillIds.length
      ? await tx.saleInvoiceLine.findMany({
          where: { invoiceId: { in: serverBillIds } },
          select: {
            id: true,
            itemId: true,
            itemName: true,
            qty: true,
            taxableAmount: true,
            cgstAmount: true,
            sgstAmount: true,
            igstAmount: true,
            invoice: { select: { invoiceNo: true } },
            returnLines: {
              where: { returnInvoiceId: { notIn: returnIds } },
              select: { qty: true, taxableAmount: true, cgstAmount: true, sgstAmount: true, igstAmount: true }
            }
          }
        })
      : [];
    const serverSaleLines = new Map<string, ServerSaleLine>(
      serverLines.map((line) => {
        const total = (pick: (row: (typeof line.returnLines)[number]) => Prisma.Decimal) => line.returnLines.reduce((sum, row) => sum + toNumber(pick(row)), 0);
        return [
          line.id,
          {
            id: line.id,
            invoiceNo: line.invoice.invoiceNo,
            itemId: line.itemId,
            itemName: line.itemName,
            qty: toNumber(line.qty),
            taxable: toNumber(line.taxableAmount),
            cgst: toNumber(line.cgstAmount),
            sgst: toNumber(line.sgstAmount),
            igst: toNumber(line.igstAmount),
            returned: {
              qty: total((row) => row.qty),
              taxable: total((row) => row.taxableAmount),
              cgst: total((row) => row.cgstAmount),
              sgst: total((row) => row.sgstAmount),
              igst: total((row) => row.igstAmount)
            }
          }
        ];
      })
    );
    return {
      taxCalculationMode: business?.taxCalculationMode ?? 'AFTER_DISCOUNT',
      maxDiscountPercentFor: (userId: string) => (admins.has(userId) ? null : cashierLimit),
      serverSaleLines
    };
  }

  /**
   * What would stop the offline sales going in as they are: an invoice, receipt or return number
   * the server has already used for something else; an item, customer or staff member they point
   * at that the server no longer has; or goods returned offline that were also returned online.
   * Rows already added (a retry) are not clashes.
   */
  private async conflicts(
    tx: Prisma.TransactionClient,
    outbox: FallbackOutbox & { returns: NonNullable<FallbackOutbox['returns']> },
    addedCustomers: Set<string>
  ): Promise<SyncConflict[]> {
    const timezone = (await tx.businessSettings.findUnique({ where: { id: 'default' }, select: { timezone: true } }))?.timezone ?? 'Asia/Kolkata';
    const when = (date: Date) => date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone });
    const conflicts: SyncConflict[] = [];
    const ids = (rows: Array<Record<string, unknown>>) => rows.map((row) => String(row.id));
    const invoiceNoOf = new Map(outbox.invoices.map((entry) => [String(entry.invoice.id), String(entry.invoice.invoiceNo)]));

    const invoices = outbox.invoices.map((entry) => entry.invoice);
    const takenInvoices = await tx.saleInvoice.findMany({
      where: { invoiceNo: { in: invoices.map((row) => String(row.invoiceNo)) }, id: { notIn: ids(invoices) } },
      select: { invoiceNo: true, createdAt: true }
    });
    for (const taken of takenInvoices) {
      conflicts.push({
        document: `Invoice ${taken.invoiceNo}`,
        problem: `This number was also used online (${when(taken.createdAt)}), for another sale.`
      });
    }

    const receipts = outbox.invoices.flatMap((entry) => entry.receipts);
    const takenReceipts = await tx.receipt.findMany({
      where: { receiptNo: { in: receipts.map((row) => String(row.receiptNo)) }, id: { notIn: ids(receipts) } },
      select: { receiptNo: true, createdAt: true }
    });
    for (const taken of takenReceipts) {
      conflicts.push({
        document: `Receipt ${taken.receiptNo}`,
        problem: `This number was also used online (${when(taken.createdAt)}), for another payment.`
      });
    }

    const missing = async (model: 'item' | 'customer' | 'user', wanted: string[]) => {
      const unique = [...new Set(wanted)];
      if (unique.length === 0) return new Set<string>();
      const where = { id: { in: unique } };
      const found =
        model === 'item'
          ? await tx.item.findMany({ where, select: { id: true } })
          : model === 'customer'
            ? await tx.customer.findMany({ where, select: { id: true } })
            : await tx.user.findMany({ where, select: { id: true } });
      const present = new Set(found.map((row) => row.id));
      return new Set(unique.filter((id) => !present.has(id)));
    };
    const lines = outbox.invoices.flatMap((entry) => entry.lines);
    const missingItems = await missing('item', [...lines, ...outbox.invoices.flatMap((entry) => entry.ledger)].map((row) => String(row.itemId)));
    for (const row of lines.filter((line) => missingItems.has(String(line.itemId)))) {
      conflicts.push({
        document: `Invoice ${invoiceNoOf.get(String(row.invoiceId))}`,
        problem: `Its item "${String(row.itemName)}" is no longer on the server.`
      });
    }
    const missingCustomers = await missing('customer', invoices.map((row) => String(row.customerId)).filter((id) => !addedCustomers.has(id)));
    for (const row of invoices.filter((invoice) => missingCustomers.has(String(invoice.customerId)))) {
      conflicts.push({ document: `Invoice ${String(row.invoiceNo)}`, problem: `Its customer "${String(row.customerName)}" is no longer on the server.` });
    }
    const returns = outbox.returns.map((entry) => entry.ret);
    const takenReturns = await tx.returnInvoice.findMany({
      where: { returnNo: { in: returns.map((row) => String(row.returnNo)) }, id: { notIn: ids(returns) } },
      select: { returnNo: true, createdAt: true }
    });
    for (const taken of takenReturns) {
      conflicts.push({ document: `Return ${taken.returnNo}`, problem: `This number was also used online (${when(taken.createdAt)}), for another return.` });
    }
    // Returns of bills the server already had (the copy's): not more than was sold, nor more
    // money back than was paid, counting what was returned online meanwhile.
    const already = new Set((await tx.returnInvoice.findMany({ where: { id: { in: ids(returns) } }, select: { id: true } })).map((row) => row.id));
    const offline = outbox.returns.filter((entry) => !already.has(String(entry.ret.id)) && !invoiceNoOf.has(String(entry.ret.saleInvoiceId)));
    const billIds = [...new Set(offline.map((entry) => String(entry.ret.saleInvoiceId)))];
    if (billIds.length) {
      const bills = await tx.saleInvoice.findMany({
        where: { id: { in: billIds } },
        select: {
          id: true,
          invoiceNo: true,
          grandTotal: true,
          paidTotal: true,
          lines: { select: { id: true, itemName: true, qty: true, returnLines: { select: { qty: true } } } },
          returns: { select: { refundAmount: true } }
        }
      });
      for (const bill of bills) {
        const mine = offline.filter((entry) => entry.ret.saleInvoiceId === bill.id);
        const returnNos = mine.map((entry) => String(entry.ret.returnNo)).join(', ');
        if (mine.some((entry) => Number(entry.ret.dueAdjusted ?? 0) > 0)) {
          conflicts.push({ document: `Return ${returnNos}`, problem: `It lowers what is owed on ${bill.invoiceNo}, which can't be done offline.` });
        }
        for (const line of bill.lines) {
          const online = line.returnLines.reduce((sum, row) => sum + toNumber(row.qty), 0);
          const offlineQty = mine.flatMap((entry) => entry.lines).filter((row) => row.saleLineId === line.id).reduce((sum, row) => sum + Number(row.qty ?? 0), 0);
          if (offlineQty > 0 && online + offlineQty > toNumber(line.qty) + 1e-9) {
            conflicts.push({
              document: `Return ${returnNos}`,
              problem: `More "${line.itemName}" would be returned on ${bill.invoiceNo} than was sold: some were also returned online.`
            });
          }
        }
        const refunded = bill.returns.reduce((sum, row) => sum + toNumber(row.refundAmount), 0) + mine.reduce((sum, entry) => sum + Number(entry.ret.refundAmount ?? 0), 0);
        if (refunded > Math.min(toNumber(bill.paidTotal), toNumber(bill.grandTotal)) + 0.005) {
          conflicts.push({ document: `Return ${returnNos}`, problem: `More money would be handed back on ${bill.invoiceNo} than was paid for it.` });
        }
      }
    }

    const missingUsers = await missing('user', outbox.registers.map((row) => String(row.userId)));
    for (const row of outbox.registers.filter((register) => missingUsers.has(String(register.userId)))) {
      conflicts.push({
        document: `The register opened ${when(new Date(String(row.openedAt)))}`,
        problem: 'The staff member who opened it is no longer on the server.'
      });
    }
    return conflicts;
  }

  isUuid(value: string) {
    return UUID.test(value);
  }
}
