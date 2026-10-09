import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DocumentKind, InvoiceStatus, PaymentMode, Prisma, StockTxnType, UserRole } from '@prisma/client';
import { chargesGst, documentTypeFor } from '@pos/contracts';
import { PrismaService } from '../prisma.service';
import { isFallback } from '../common/mode';
import type { PaymentInput, SessionUser, CreateSaleInput } from '../common/types';
import { toNumber, round2, round3 } from '../common/numbers';
import { requireSessionBranchId } from '../common/session';
import { saleInvoiceInclude } from '../common/selects';
import { SettingsService } from '../settings/settings.service';
import { SequenceService } from '../sequences/sequences.service';
import { ItemsService } from '../items/items.service';
import { StockService } from '../stock/stock.service';
import { splitOverShares } from '../stock/batches';
import { businessToday, sharesOfLines, takeFromBatches, takenOrder } from '../stock/batch-stock';
import { CustomersService } from '../customers/customers.service';
import { ReceivablesService } from '../customers/receivables.service';
import { RegistersService } from '../registers/registers.service';
import { localDate } from '../reports/zoned-dates';
import { afterCursor, newestFirst, type PageQuery } from '../common/paging';
import { AuditService } from '../common/audit.service';
import {
  assertWithinCashierDiscountLimit,
  calculateSaleTotals,
  discountRowsFor,
  normalizeSaleLines,
  resolvePlaceOfSupply,
  saleLineRows
} from './sale-lines';
import { SaleSettlementService } from './sale-settlement.service';

/**
 * A sale's transaction: long enough for a big cart on a slow link to the database (Prisma's
 * default is 5 seconds), and a wait for a connection that fails a busy till soon rather than late.
 */
const SALE_TRANSACTION = { timeout: 20_000, maxWait: 10_000 };

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly sequences: SequenceService,
    private readonly items: ItemsService,
    private readonly stock: StockService,
    private readonly customers: CustomersService,
    private readonly receivables: ReceivablesService,
    private readonly registers: RegistersService,
    private readonly audit: AuditService,
    private readonly settlement: SaleSettlementService
  ) {}

  /** An unpaid (DRAFT) invoice: all of it is owed until paid, so it must fit the customer's credit limit. */
  async createSale(session: SessionUser, input: CreateSaleInput) {
    return this.prisma.$transaction(async (tx) => {
      const invoice = await this.createSaleInTx(tx, session, input);
      await this.receivables.assertWithinCreditLimit(tx, session, invoice.customerId);
      return invoice;
    }, SALE_TRANSACTION);
  }

  /** Creates a DRAFT invoice and deducts its stock, inside the caller's transaction. */
  private async createSaleInTx(tx: Prisma.TransactionClient, session: SessionUser, input: CreateSaleInput) {
    const sessionBranchId = requireSessionBranchId(session);
    if (sessionBranchId !== input.branchId) {
      throw new ForbiddenException('Branch mismatch');
    }

    await this.settings.ensureBranchExists(input.branchId, tx);
    const businessSettings = await this.settings.ensureBusinessSettings(tx);
    // The registration type now decides the bill: a composition taxpayer may not charge GST.
    const taxpayer = await this.settings.taxpayerTypeAt(new Date(), tx);
    const chargeTax = chargesGst(taxpayer.taxpayerType);
    const registration = await this.settings.gstRegistrationFor(input.branchId, tx);
    if (taxpayer.taxpayerType !== 'UNREGISTERED' && !registration.gstin) {
      throw new BadRequestException('Set a valid seller GSTIN in Business or Branch Settings before billing as a registered business; unregistered shops must choose Unregistered in Tax Settings');
    }
    const seller = taxpayer.taxpayerType === 'UNREGISTERED' ? { gstin: null, stateCode: registration.stateCode } : registration;
    const placeOfSupplyStateCode = resolvePlaceOfSupply(seller.stateCode, input.placeOfSupplyStateCode, taxpayer.taxpayerType);
    const interState = !!seller.stateCode && !!placeOfSupplyStateCode && placeOfSupplyStateCode !== seller.stateCode;
    const customer = await tx.customer.findUnique({
      where: { id: input.customerId },
      select: { id: true, branchId: true, name: true, phone: true, isWalkIn: true, gstin: true, address: true, paymentTermsDays: true }
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    if (!this.customers.customerUsableAt(customer, input.branchId, businessSettings.customerScope)) {
      throw new BadRequestException('Customer does not belong to this branch');
    }
    const walkInCustomerName = input.walkInCustomerName?.trim();
    const walkInCustomerPhone = input.walkInCustomerPhone?.trim();
    const invoiceCustomerName =
      customer.isWalkIn && walkInCustomerName ? walkInCustomerName : customer.name;
    const invoiceCustomerPhone =
      customer.isWalkIn && walkInCustomerPhone ? walkInCustomerPhone : customer.phone;
    const createdByUser = await tx.user.findUnique({
      where: { id: session.userId },
      select: { username: true, role: true, permissions: true }
    });
    if (!createdByUser) {
      throw new NotFoundException('User not found');
    }
    const normalizedLines = await normalizeSaleLines(tx, input.branchId, input.lines, chargeTax);

    // Check stock per item, adding up every line of it in base units (a box and a
    // loose piece of the same item draw on the same stock), under the item locks.
    const qtyByItem = new Map<string, { name: string; qty: number }>();
    for (const line of normalizedLines) {
      const entry = qtyByItem.get(line.itemId);
      qtyByItem.set(line.itemId, { name: line.itemName, qty: round3((entry?.qty ?? 0) + line.qty) });
    }
    await this.stock.lockItemStock(tx, input.branchId, Array.from(qtyByItem.keys()));
    // When the count is wrong the goods are still on the counter: a business can let admins, and
    // cashiers it allows, sell past it (stock goes below 0 until someone corrects the count).
    const maySellPastStock =
      businessSettings.allowNegativeStock &&
      (createdByUser.role === UserRole.ADMIN || createdByUser.permissions.includes('SELL_PAST_STOCK'));
    const onHandByItem = await this.stock.getOnHandForItems(tx, input.branchId, Array.from(qtyByItem.keys()));
    for (const [itemId, { name, qty }] of qtyByItem) {
      const onHand = onHandByItem.get(itemId) ?? 0;
      if (onHand + 1e-9 < qty && !maySellPastStock) {
        throw new BadRequestException(
          `Insufficient stock for ${name}: ${round3(onHand)} on hand, ${qty} needed` +
            (businessSettings.allowNegativeStock ? '. Ask an admin to sell it past the stock count.' : '')
        );
      }
    }
    // Items kept by batch: the earliest expiry first, never expired stock.
    const batchShares = await takeFromBatches(tx, input.branchId, qtyByItem, { today: await businessToday(tx), allowShort: maySellPastStock });

    // Numbered in the series of the counter the sale is made at.
    const { counterId } = await this.registers.assertRegisterOpen(tx, session);
    const { number: invoiceNo, series: documentSeries, fiscalYear } = await this.sequences.nextDocumentNumber(
      tx,
      counterId,
      DocumentKind.INVOICE
    );

    const {
      computedLines,
      orderDiscountPlans,
      subTotal,
      discountTotal,
      orderDiscountTotal,
      taxTotal,
      cgstTotal,
      sgstTotal,
      igstTotal,
      roundOff,
      grandTotal
    } = calculateSaleTotals(
      normalizedLines,
      input.discounts ?? [],
      chargeTax,
      interState,
      businessSettings.roundOffMode
    );
    if (session.role !== UserRole.ADMIN) {
      assertWithinCashierDiscountLimit(
        normalizedLines,
        computedLines,
        toNumber(businessSettings.cashierMaxDiscountPercent),
        chargeTax
      );
    }

    const invoice = await tx.saleInvoice.create({
      data: {
        branchId: input.branchId,
        invoiceNo,
        documentSeries,
        fiscalYear,
        idempotencyKey: input.idempotencyKey,
        customerId: input.customerId,
        customerName: invoiceCustomerName,
        customerPhone: invoiceCustomerPhone,
        // A registered buyer's details as they are now; later edits to the customer don't change the bill.
        buyerGstin: customer.isWalkIn ? null : customer.gstin,
        buyerAddress: customer.isWalkIn || !customer.gstin ? null : customer.address,
        reference: input.reference?.trim() || null,
        // Whatever is left unpaid falls due after the customer's payment terms.
        dueDate: customer.isWalkIn ? null : this.receivables.dueDateFor(new Date(), customer.paymentTermsDays, businessSettings.timezone),
        status: InvoiceStatus.DRAFT,
        subTotal,
        discountTotal,
        orderDiscountAmount: orderDiscountTotal,
        taxTotal,
        cgstTotal,
        sgstTotal,
        igstTotal,
        roundOff,
        grandTotal,
        paidTotal: 0,
        createdBy: session.userId,
        createdByName: createdByUser.username,
        taxpayerType: taxpayer.taxpayerType,
        documentType: documentTypeFor(taxpayer.taxpayerType),
        compositionCategory: taxpayer.compositionCategory,
        sellerGstin: seller.gstin,
        sellerStateCode: seller.stateCode,
        placeOfSupplyStateCode
      },
      select: { id: true }
    });

    // Lines, discounts and their allocations in three inserts, with their ids made here.
    const createdLines = computedLines.map(() => ({ id: randomUUID() }));
    await tx.saleInvoiceLine.createMany({ data: saleLineRows(invoice.id, computedLines, createdLines) });
    const { discountRows, allocationRows } = discountRowsFor(invoice.id, computedLines, orderDiscountPlans, createdLines);
    if (discountRows.length > 0) await tx.discount.createMany({ data: discountRows });
    if (allocationRows.length > 0) await tx.discountAllocation.createMany({ data: allocationRows });

    const createdInvoice = await tx.saleInvoice.findUnique({
      where: { id: invoice.id },
      include: saleInvoiceInclude
    });
    if (!createdInvoice) {
      throw new NotFoundException('Invoice not found after creation');
    }

    await this.stock.recordStock(
      tx,
      splitOverShares(
        computedLines.map((line, index) => ({ lineId: createdLines[index].id, itemId: line.itemId, qty: line.qty })),
        batchShares
      ).map((part) => ({
        branchId: input.branchId,
        itemId: part.line.itemId,
        txnType: StockTxnType.SALE,
        qtyIn: 0,
        qtyOut: part.qty,
        referenceType: 'SALE',
        referenceId: invoice.id,
        lineId: part.line.lineId,
        batchId: part.batchId
      }))
    );

    return createdInvoice;
  }

  /**
   * Creates and pays a sale in one transaction, so a failed payment leaves no DRAFT
   * invoice holding stock. With no payments it is a credit sale (registered customers).
   * The POS sends a fresh idempotency key per checkout and reuses it on retry: a key that
   * already made an invoice returns that invoice instead of creating a second one.
   */
  async checkoutSale(session: SessionUser, input: CreateSaleInput & { idempotencyKey: string; payments: PaymentInput[] }) {
    const existing = await this.findCheckoutReplay(session, input.idempotencyKey);
    if (existing) return existing;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await this.createSaleInTx(tx, session, input);
        const result =
          input.payments.length === 0
            ? { invoice: created, receipt: null }
            : await this.settlement.settleSaleInTx(tx, session, created.id, input.payments);
        // Working offline (fallback counter): no wallet payments or change into a wallet, which
        // need the server's balances. Credit is fine, within the limit as the copy has it.
        if (isFallback()) {
          const paid = input.payments.reduce((sum, payment) => sum + payment.amount, 0);
          if (input.payments.some((payment) => payment.mode === PaymentMode.WALLET) || paid > toNumber(result.invoice.grandTotal) + 0.005) {
            throw new BadRequestException("While working offline, the wallet can't be used: take cash or card, no more than the bill, or sell on credit.");
          }
        }
        // Nobody to collect the rest from, so walk-in sales must be paid in full.
        if (result.invoice.status !== InvoiceStatus.SETTLED) {
          const customer = await tx.customer.findUnique({ where: { id: input.customerId }, select: { isWalkIn: true } });
          if (customer?.isWalkIn) {
            throw new BadRequestException('Walk-in sales must be paid in full');
          }
          await this.receivables.assertWithinCreditLimit(tx, session, input.customerId);
        }
        return { ...result, invoice: await this.withLineBatches(tx, result.invoice) };
      }, SALE_TRANSACTION);
    } catch (error) {
      // A concurrent request with the same key won the race; return what it created.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const replay = await this.findCheckoutReplay(session, input.idempotencyKey);
        if (replay) return replay;
      }
      throw error;
    }
  }

  private async findCheckoutReplay(session: SessionUser, idempotencyKey: string) {
    const invoice = await this.prisma.saleInvoice.findUnique({
      where: { idempotencyKey },
      include: saleInvoiceInclude
    });
    if (!invoice) return null;
    if (invoice.createdBy !== session.userId || invoice.branchId !== session.branchId) {
      throw new BadRequestException('This checkout key was already used');
    }
    const receipt = await this.prisma.receipt.findFirst({
      where: { invoiceId: invoice.id },
      orderBy: { createdAt: 'desc' }
    });
    return { invoice: await this.withLineBatches(this.prisma, invoice), receipt };
  }

  /**
   * For an unpaid DRAFT invoice at `branchId` (one left behind when payment failed, or a credit
   * sale nothing has been paid on): marks it CANCELLED, records who did it and why, and puts its
   * stock back. Only on the day it was made (business time zone): later, the goods have gone and
   * the bill may be in a filed GST return, so the way out is a return (credit note). The caller
   * checks who may (admins, and cashiers allowed to cancel unpaid bills).
   */
  async cancelSale(session: SessionUser, branchId: string, invoiceId: string, reason: string) {
    const sessionBranchId = branchId;
    const cancelReason = reason?.trim() ?? '';
    if (cancelReason.length < 3) throw new BadRequestException('Say why the bill is cancelled');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "SaleInvoice" WHERE id = ${invoiceId} FOR UPDATE`;
      const invoice = await tx.saleInvoice.findFirst({
        where: { id: invoiceId, branchId: sessionBranchId },
        include: { lines: { select: { id: true, itemId: true, qty: true } } }
      });
      if (!invoice) throw new NotFoundException('Invoice not found');
      if (invoice.status !== InvoiceStatus.DRAFT || toNumber(invoice.paidTotal) > 0) {
        throw new BadRequestException(`Only unpaid draft invoices can be cancelled; ${invoice.invoiceNo} is ${invoice.status}`);
      }
      const { timezone } = await this.settings.ensureBusinessSettings(tx);
      const day = (at: Date) => {
        const { year, month, day: d } = localDate(at, timezone);
        return `${year}-${month}-${d}`;
      };
      if (day(invoice.createdAt) !== day(new Date())) {
        throw new BadRequestException(`${invoice.invoiceNo} was made on an earlier day, so it can't be cancelled; make a return instead.`);
      }
      const canceller = await tx.user.findUnique({ where: { id: session.userId }, select: { username: true } });
      if (!canceller) throw new NotFoundException('User not found');
      // Back into the batches each line took (a bill from before batches took none).
      const taken = await sharesOfLines(tx, invoice.lines.map((line) => line.id), 'OUT');
      await this.stock.recordStock(
        tx,
        invoice.lines.flatMap((line) =>
          (taken.get(line.id) ?? [{ batchId: null, qty: toNumber(line.qty) }]).map((share) => ({
            branchId: invoice.branchId,
            itemId: line.itemId,
            txnType: StockTxnType.SALE_CANCEL,
            qtyIn: share.qty,
            qtyOut: 0,
            referenceType: 'SALE_CANCEL',
            referenceId: invoice.id,
            lineId: line.id,
            batchId: share.batchId
          }))
        )
      );
      const updated = await tx.saleInvoice.update({
        where: { id: invoice.id },
        data: {
          status: InvoiceStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledBy: session.userId,
          cancelledByName: canceller.username,
          cancelReason
        },
        include: saleInvoiceInclude
      });
      await this.audit.record(
        session,
        {
          action: 'SALE_CANCELLED',
          entityType: 'SaleInvoice',
          entityId: invoice.id,
          branchId: invoice.branchId,
          summary: `Cancelled ${invoice.invoiceNo} (${toNumber(invoice.grandTotal).toFixed(2)}): ${cancelReason}`,
          details: { invoiceNo: invoice.invoiceNo, grandTotal: toNumber(invoice.grandTotal), reason: cancelReason }
        },
        tx
      );
      return updated;
    });
  }

  async settleSale(session: SessionUser, invoiceId: string, payments: PaymentInput[], idempotencyKey?: string) {
    return this.prisma.$transaction(async (tx) => {
      const result = await this.settlement.settleSaleInTx(tx, session, invoiceId, payments, idempotencyKey);
      return { ...result, invoice: await this.withLineBatches(tx, result.invoice) };
    }, SALE_TRANSACTION);
  }

  /** The branch of an invoice (by id or number), or of a receipt; null when there is none. */
  async branchOf(key: { invoice?: string; receipt?: string }) {
    if (key.receipt) {
      const receipt = await this.prisma.receipt.findUnique({ where: { id: key.receipt }, select: { invoice: { select: { branchId: true } } } });
      return receipt?.invoice.branchId ?? null;
    }
    const value = key.invoice?.trim() ?? '';
    const invoice = await this.prisma.saleInvoice.findFirst({ where: { OR: [{ id: value }, { invoiceNo: value }] }, select: { branchId: true } });
    return invoice?.branchId ?? null;
  }

  /** A page of the branch's bills, newest first, matching the filters. */
  async listSales(
    branchId: string,
    filters: PageQuery & { search?: string; status?: InvoiceStatus; owed?: boolean; customerId?: string } = { limit: 100 }
  ) {
    const search = filters.search?.trim();
    const owedIds =
      filters.owed === undefined
        ? undefined
        : (
            await this.prisma.$queryRaw<Array<{ id: string }>>`
              SELECT "id" FROM "SaleInvoice"
              WHERE "branchId" = ${branchId} AND "status" <> 'CANCELLED'
                AND "grandTotal" - "paidTotal" - "creditedTotal" > 0.005`
          ).map((row) => row.id);
    return this.prisma.saleInvoice.findMany({
      where: {
        branchId,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.customerId ? { customerId: filters.customerId } : {}),
        ...(owedIds ? (filters.owed ? { id: { in: owedIds } } : { id: { notIn: owedIds } }) : {}),
        ...(search
          ? {
              AND: [
                {
                  OR: [
                    { invoiceNo: { contains: search, mode: 'insensitive' as const } },
                    { customerName: { contains: search, mode: 'insensitive' as const } },
                    { customerPhone: { contains: search } },
                    { createdByName: { contains: search, mode: 'insensitive' as const } }
                  ]
                },
                afterCursor(filters)
              ]
            }
          : afterCursor(filters))
      },
      orderBy: newestFirst,
      take: filters.limit,
      include: {
        discounts: true
      }
    });
  }

  async getSaleById(branchId: string, id: string) {
    const invoice = await this.prisma.saleInvoice.findFirst({
      where: { id, branchId },
      include: {
        lines: {
          include: {
            discountAllocations: true,
            returnLines: {
              select: {
                id: true,
                returnInvoiceId: true,
                qty: true,
                amount: true,
                taxableAmount: true,
                taxAmount: true,
                cgstAmount: true,
                sgstAmount: true,
                igstAmount: true
              }
            }
          }
        },
        payments: true,
        returns: { select: { roundOff: true } },
        discounts: true
      }
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    const { returns, ...sale } = invoice;
    return { ...await this.withLineBatches(this.prisma, sale), returnedRoundOff: round2(returns.reduce((sum, ret) => sum + toNumber(ret.roundOff), 0)) };
  }

  /** The invoice with the batches each line was sold from (printed on the bill for items kept by batch). */
  private async withLineBatches<I extends { lines: Array<{ id: string }> }>(client: Prisma.TransactionClient | PrismaService, invoice: I) {
    const sold = await client.stockLedger.findMany({
      where: { lineId: { in: invoice.lines.map((line) => line.id) }, txnType: StockTxnType.SALE, batchId: { not: null } },
      select: { lineId: true, qtyOut: true, batch: { select: { batchNo: true, expiryDate: true, createdAt: true } } }
    });
    sold.sort(takenOrder);
    return {
      ...invoice,
      lines: invoice.lines.map((line) => ({
        ...line,
        batches: sold
          .filter((row) => row.lineId === line.id && row.batch)
          .map((row) => ({ batchNo: row.batch!.batchNo, expiryDate: row.batch!.expiryDate, qty: toNumber(row.qtyOut) }))
      }))
    };
  }

  async getReceiptById(branchId: string, id: string) {
    const receipt = await this.prisma.receipt.findFirst({ where: { id, invoice: { branchId } } });
    if (!receipt) throw new NotFoundException('Receipt not found');
    return receipt;
  }

  async getReceiptsByInvoice(branchId: string, invoiceId: string) {
    const key = invoiceId.trim();
    const receiptsById = await this.prisma.receipt.findMany({
      where: { invoiceId: key, invoice: { branchId } },
      orderBy: { createdAt: 'desc' }
    });
    if (receiptsById.length > 0) return receiptsById;

    const receiptsByInvoiceNo = await this.prisma.receipt.findMany({
      where: { invoice: { invoiceNo: key, branchId } },
      orderBy: { createdAt: 'desc' }
    });

    if (receiptsByInvoiceNo.length > 0) return receiptsByInvoiceNo;

    throw new NotFoundException('Receipt not found for given invoice id/number');
  }
}
