import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { CustomerScope, DocumentKind, Prisma } from '@prisma/client';
import { APP_VERSION, documentSeries } from '@pos/contracts';
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
};

type FallbackCounter = { id: string; branchId: string; number: number; name: string; branchCode: string };

/**
 * The fallback counter on the online server: one counter per branch bound to one computer,
 * which keeps a local copy of what selling needs and, after working offline, sends its sales.
 */
@Injectable()
export class FallbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
    private readonly branches: BranchesService
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
   * the counter's invoice series and its open register. No sales history. Returns the file.
   */
  async snapshot(counter: FallbackCounter) {
    const settings = await this.prisma.businessSettings.findUnique({ where: { id: 'default' }, select: { customerScope: true, logoUrl: true } });
    const branch = await this.prisma.branch.findUniqueOrThrow({ where: { id: counter.branchId }, select: { logoUrl: true } });
    const branchId = lit(counter.branchId);
    const staff = `SELECT "userId" FROM "UserBranchAccess" WHERE "branchId" = ${branchId}`;
    const only = [
      { name: 'BusinessSettings' },
      { name: 'TaxpayerTypeChange' },
      { name: 'Branch' },
      { name: 'Counter', where: `"branchId" = ${branchId}` },
      { name: 'DocumentSequence', where: `"kind" = 'INVOICE' AND "series" = ${lit(documentSeries(counter.branchCode, counter.number, DocumentKind.INVOICE))}` },
      { name: 'User', where: `"id" IN (${staff})` },
      { name: 'UserBranchAccess', where: `"userId" IN (${staff})` },
      { name: 'Customer', where: settings?.customerScope === CustomerScope.BRANCH ? `"branchId" = ${branchId}` : undefined },
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
    const registerIds = new Set(outbox.registers.map((row) => String(row.id)));
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
    for (const sequence of outbox.sequences) {
      if (sequence.kind !== 'INVOICE' || sequence.series !== invoiceSeries) fail("another series' numbers");
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
          if (outbox.registers.length) {
            // A register opened offline when the copy didn't have the one open online (opened
            // after the copy's last refresh): that one ended when the offline one began.
            const known = new Set(
              (await tx.registerSession.findMany({ where: { id: { in: [...registerIds] } }, select: { id: true } })).map((row) => row.id)
            );
            for (const register of outbox.registers.filter((row) => !known.has(String(row.id)))) {
              await tx.registerSession.updateMany({
                where: { counterId: counter.id, closedAt: null, id: { notIn: [...registerIds] }, openedAt: { lt: new Date(String(register.openedAt)) } },
                data: { closedAt: new Date(String(register.openedAt)) }
              });
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
          const all = (pick: (entry: FallbackOutbox['invoices'][number]) => Array<Record<string, unknown>>) => outbox.invoices.flatMap(pick);
          // An older copy's bills have no creditedTotal (nothing is returned offline anyway).
          const invoices = await insert(tx, rows('SaleInvoice', outbox.invoices.map((entry) => ({ creditedTotal: 0, ...entry.invoice }))));
          await insert(tx, rows('SaleInvoiceLine', all((entry) => entry.lines)));
          await insert(tx, rows('Discount', all((entry) => entry.discounts)));
          await insert(tx, rows('DiscountAllocation', all((entry) => entry.allocations)));
          await insert(tx, rows('Payment', all((entry) => entry.payments)));
          await insert(tx, rows('Receipt', all((entry) => entry.receipts)));
          const ledger = all((entry) => entry.ledger);
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
          return { invoices, registers: outbox.registers.length };
        },
        { timeout: 120_000, maxWait: 30_000 }
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError || error instanceof Prisma.PrismaClientUnknownRequestError) {
        // A number already used online, or an item or customer deleted meanwhile: needs a person.
        throw new ConflictException(
          `The offline sales couldn't be added (${error.message.split('\n').filter(Boolean).at(-1)}). They stay on this computer; contact support.`
        );
      }
      throw error;
    }
  }

  isUuid(value: string) {
    return UUID.test(value);
  }
}
