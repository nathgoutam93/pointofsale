import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DiscountScope, DocumentKind, InvoiceStatus, PaymentMode, Prisma, StockTxnType, TaxpayerType, UserRole, WalletTxnType } from '@prisma/client';
import { chargesGst, computeSaleTotals, documentTypeFor, exclusiveBase, invoiceDue, mrpProblem, resolveDiscountAmounts } from '@pos/contracts';
import type { DiscountInput, RoundOffMode } from '@pos/contracts';
import { PrismaService } from '../prisma.service';
import { isFallback } from '../common/mode';
import type { PaymentInput, SessionUser, SaleLineInput, CreateSaleInput, ComputedSaleLine } from '../common/types';
import { toNumber, round2, round3 } from '../common/numbers';
import { assertQtyRespectsLeastCount } from '../common/quantities';
import { requireSessionBranchId } from '../common/session';
import { saleInvoiceInclude } from '../common/selects';
import { withBranchPrices } from '../common/branch-prices';
import { SettingsService } from '../settings/settings.service';
import { SequenceService } from '../sequences/sequences.service';
import { ItemsService } from '../items/items.service';
import { StockService } from '../stock/stock.service';
import { CustomersService, walletTxnAuthor } from '../customers/customers.service';
import { ReceivablesService } from '../customers/receivables.service';
import { RegistersService } from '../registers/registers.service';
import { localDate } from '../reports/zoned-dates';

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
    private readonly registers: RegistersService
  ) {}

  /** The quantity a line is priced in: sale units when it has one, otherwise base units. */
  private pricingQty(line: Pick<SaleLineInput, 'qty' | 'saleUomQty'>) {
    return line.saleUomQty ?? line.qty;
  }

  /**
   * Works out a sale line's unit, conversion, list price and tax from the item. From the
   * request only the quantity, the chosen unit and a price at or below list are used; a
   * tax or unit size that doesn't match the item means the POS screen is out of date.
   */
  private resolveLinePricing(
    item: {
      name: string;
      uom: string;
      sellPrice: Prisma.Decimal;
      mrp: Prisma.Decimal;
      taxRate: Prisma.Decimal;
      taxMode: 'INCLUSIVE' | 'EXCLUSIVE';
      saleUoms: Array<{ uom: string; conversionQty: Prisma.Decimal; sellPrice: Prisma.Decimal; mrp: Prisma.Decimal; isDefault: boolean }>;
    },
    line: SaleLineInput,
    chargeTax: boolean
  ) {
    const taxRate = toNumber(item.taxRate);
    const taxMode = item.taxMode;
    if (Math.abs(line.taxRate - taxRate) > 1e-6 || (line.taxMode !== undefined && line.taxMode !== taxMode)) {
      throw new BadRequestException(`Tax for ${item.name} has changed. Refresh and try again.`);
    }

    const requestedUom = line.saleUom?.trim();
    const isBaseUom = !requestedUom || requestedUom.toLowerCase() === item.uom.toLowerCase();
    const variant = isBaseUom
      ? undefined
      : item.saleUoms.find((entry) => !entry.isDefault && entry.uom.toLowerCase() === requestedUom.toLowerCase());
    if (!isBaseUom && !variant) {
      throw new BadRequestException(`${item.name} is not sold in ${requestedUom}. Refresh and try again.`);
    }

    let qty = round3(line.qty);
    let saleUomQty: number | undefined;
    let saleUomConversionQty: number | undefined;
    let listRate = toNumber(item.sellPrice);
    let mrp = toNumber(item.mrp);
    if (variant) {
      if (line.saleUomQty === undefined) {
        throw new BadRequestException(`Sale line ${line.itemId} has incomplete UOM details`);
      }
      saleUomConversionQty = toNumber(variant.conversionQty);
      if (line.saleUomConversionQty !== undefined && Math.abs(line.saleUomConversionQty - saleUomConversionQty) > 1e-6) {
        throw new BadRequestException(`${item.name} ${variant.uom} size has changed. Refresh and try again.`);
      }
      saleUomQty = round3(line.saleUomQty);
      qty = round3(saleUomQty * saleUomConversionQty);
      if (Math.abs(qty - round3(line.qty)) > 1e-6) {
        throw new BadRequestException(`Sale line ${line.itemId} UOM quantity does not match stock quantity`);
      }
      listRate = toNumber(variant.sellPrice);
      mrp = toNumber(variant.mrp);
    }

    const rate = round2(line.rate);
    if (rate > listRate) {
      throw new BadRequestException(`Price for ${item.name} can't be above its list price of ${listRate.toFixed(2)}`);
    }
    // Never above the MRP (0: none printed; it includes GST), even if the list price was set above it.
    const overMrp = mrpProblem(rate, mrp, taxMode, taxRate, chargeTax);
    if (overMrp) {
      throw new BadRequestException(`Price for ${item.name} can't be above its MRP: ${overMrp}`);
    }
    return { qty, rate, listRate, saleUom: variant?.uom, saleUomQty, saleUomConversionQty, taxRate, taxMode };
  }

  /**
   * A cashier may lower a sale below list price (price changes, item and order discounts
   * together) by at most `maxPercent`, measured before tax. Admins are not limited.
   */
  private assertWithinCashierDiscountLimit(
    lines: SaleLineInput[],
    computedLines: ComputedSaleLine[],
    maxPercent: number,
    chargeTax: boolean
  ) {
    // The list total on the same footing as the sale: without tax taken out when none is charged.
    const listTotal = round2(
      lines.reduce((acc, line) => {
        const listGross = round2(this.pricingQty(line) * (line.listRate ?? line.rate));
        return acc + (chargeTax ? exclusiveBase(listGross, line.taxMode, line.taxRate) : listGross);
      }, 0)
    );
    if (listTotal <= 0) return;
    const finalTotal = round2(computedLines.reduce((acc, line) => acc + line.taxableAmount, 0));
    const reduction = round2(listTotal - finalTotal);
    // One paisa of slack for rounding, so exactly the limit is allowed.
    if (reduction > round2((listTotal * maxPercent) / 100) + 0.01) {
      const percent = (reduction / listTotal) * 100;
      throw new BadRequestException(
        `Price changes and discounts take ${percent.toFixed(2)}% off this sale; cashiers can give at most ${maxPercent}%. Ask an admin.`
      );
    }
  }

  /**
   * Where a sale's goods go: the branch's state for a counter sale, or the state they are
   * shipped to. A composition taxpayer may not sell goods to another state.
   */
  private resolvePlaceOfSupply(branchStateCode: string | null, requested: string | undefined, taxpayerType: TaxpayerType) {
    if (!requested) return branchStateCode;
    if (!branchStateCode) {
      throw new BadRequestException("Set this branch's state in Branch Settings before choosing a place of supply");
    }
    if (requested !== branchStateCode && taxpayerType === 'COMPOSITION') {
      throw new BadRequestException("A composition taxpayer can't sell goods to another state");
    }
    return requested;
  }

  /** The sale's amounts, from the maths shared with the POS (@pos/contracts computeSaleTotals). */
  private calculateSaleTotals(
    lines: SaleLineInput[],
    orderDiscounts: DiscountInput[] | undefined,
    taxCalculationMode: 'AFTER_DISCOUNT' | 'BEFORE_DISCOUNT',
    chargeTax: boolean,
    interState: boolean,
    roundOff: RoundOffMode
  ) {
    const totals = computeSaleTotals(lines, orderDiscounts, taxCalculationMode, { chargeTax, interState, roundOff });
    const computedLines: ComputedSaleLine[] = totals.lines.map((entry) => ({
      ...entry.line,
      discountAmount: entry.discountAmount,
      taxableAmount: entry.taxable,
      taxAmount: entry.tax,
      cgstAmount: entry.cgst,
      sgstAmount: entry.sgst,
      igstAmount: entry.igst,
      netAmount: entry.net,
      grossAmount: entry.gross,
      baseExclusive: entry.baseExclusive,
      itemDiscountAmount: entry.itemDiscount,
      orderDiscountAmount: entry.orderDiscount
    }));
    return {
      computedLines,
      orderDiscountPlans: totals.orderDiscountPlans,
      subTotal: totals.subTotal,
      discountTotal: totals.discountTotal,
      orderDiscountTotal: totals.orderDiscountTotal,
      taxTotal: totals.taxTotal,
      cgstTotal: totals.cgstTotal,
      sgstTotal: totals.sgstTotal,
      igstTotal: totals.igstTotal,
      roundOff: totals.roundOff,
      grandTotal: totals.grandTotal
    };
  }

  /** An unpaid (DRAFT) invoice: all of it is owed until paid, so it must fit the customer's credit limit. */
  async createSale(session: SessionUser, input: CreateSaleInput) {
    return this.prisma.$transaction(async (tx) => {
      const invoice = await this.createSaleInTx(tx, session, input);
      await this.receivables.assertWithinCreditLimit(tx, session, invoice.customerId);
      return invoice;
    });
  }

  /** Creates a DRAFT invoice and deducts its stock, inside the caller's transaction. */
  private async createSaleInTx(tx: Prisma.TransactionClient, session: SessionUser, input: CreateSaleInput) {
    const sessionBranchId = requireSessionBranchId(session);
    if (sessionBranchId !== input.branchId) {
      throw new BadRequestException('Branch mismatch');
    }

    await this.settings.ensureBranchExists(input.branchId, tx);
    const businessSettings = await this.settings.ensureBusinessSettings(tx);
    // The registration type now decides the bill: a composition taxpayer may not charge GST.
    const taxpayer = await this.settings.taxpayerTypeAt(new Date(), tx);
    const chargeTax = chargesGst(taxpayer.taxpayerType);
    const seller = await this.settings.gstRegistrationFor(input.branchId, tx);
    const placeOfSupplyStateCode = this.resolvePlaceOfSupply(seller.stateCode, input.placeOfSupplyStateCode, taxpayer.taxpayerType);
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
    const normalizedLines = [];

    for (const line of input.lines) {
      const normalizedItemId = await this.items.resolveItemId(line.itemId, tx);
      const item = await tx.item.findUnique({
        where: { id: normalizedItemId },
        select: {
          name: true,
          uom: true,
          leastCount: true,
          sellPrice: true,
          mrp: true,
          costPrice: true,
          taxRate: true,
          taxMode: true,
          hsnCode: true,
          uqc: true,
          supplyType: true,
          isActive: true,
          saleUoms: { select: { uom: true, conversionQty: true, sellPrice: true, mrp: true, isDefault: true } }
        }
      });
      if (!item) {
        throw new NotFoundException('Item not found');
      }
      if (!item.isActive) {
        throw new BadRequestException(`${item.name} is no longer for sale`);
      }
      const pricing = this.resolveLinePricing(
        withBranchPrices(item, await this.items.branchPricesFor(tx, input.branchId, normalizedItemId)),
        line,
        chargeTax
      );
      assertQtyRespectsLeastCount(pricing.qty, toNumber(item.leastCount), `Sale line ${line.itemId}`);
      normalizedLines.push({
        ...line,
        ...pricing,
        unitCost: toNumber(item.costPrice),
        hsnCode: item.hsnCode,
        uqc: item.uqc,
        supplyType: item.supplyType,
        itemId: normalizedItemId,
        itemName: item.name,
        discounts: line.discounts ?? []
      });
    }

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
    for (const [itemId, { name, qty }] of qtyByItem) {
      const onHand = await this.stock.getOnHandForItem(input.branchId, itemId, tx);
      if (onHand + 1e-9 < qty && !maySellPastStock) {
        throw new BadRequestException(
          `Insufficient stock for ${name}: ${round3(onHand)} on hand, ${qty} needed` +
            (businessSettings.allowNegativeStock ? '. Ask an admin to sell it past the stock count.' : '')
        );
      }
    }

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
    } = this.calculateSaleTotals(
      normalizedLines,
      input.discounts ?? [],
      businessSettings.taxCalculationMode,
      chargeTax,
      interState,
      businessSettings.roundOffMode
    );
    if (session.role !== UserRole.ADMIN) {
      this.assertWithinCashierDiscountLimit(
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

    const createdLines = [];
    for (const line of computedLines) {
      createdLines.push(
        await tx.saleInvoiceLine.create({
          data: {
            invoiceId: invoice.id,
            itemId: line.itemId,
            itemName: line.itemName ?? 'Unknown Item',
            qty: line.qty,
            rate: line.rate,
            listRate: line.listRate,
            unitCost: line.unitCost,
            saleUom: line.saleUom,
            saleUomQty: line.saleUomQty,
            saleUomConversionQty: line.saleUomConversionQty,
            discountAmount: line.discountAmount,
            taxMode: line.taxMode ?? 'EXCLUSIVE',
            taxRate: line.taxRate,
            taxableAmount: line.taxableAmount,
            taxAmount: line.taxAmount,
            cgstAmount: line.cgstAmount,
            sgstAmount: line.sgstAmount,
            igstAmount: line.igstAmount,
            netAmount: line.netAmount,
            hsnCode: line.hsnCode,
            uqc: line.uqc,
            supplyType: line.supplyType
          },
          select: { id: true, itemId: true }
        })
      );
    }

    for (let lineIdx = 0; lineIdx < computedLines.length; lineIdx += 1) {
      const line = computedLines[lineIdx];
      const persistedLine = createdLines[lineIdx];
      const itemDiscounts = resolveDiscountAmounts(line.discounts, line.baseExclusive);
      for (const discount of itemDiscounts) {
        const createdDiscount = await tx.discount.create({
          data: {
            saleInvoiceId: invoice.id,
            scope: DiscountScope.ITEM,
            type: discount.type,
            value: discount.value
          },
          select: { id: true }
        });
        await tx.discountAllocation.create({
          data: {
            discountId: createdDiscount.id,
            saleInvoiceLineId: persistedLine.id,
            amount: discount.amount
          }
        });
      }
    }

    for (const orderDiscount of orderDiscountPlans) {
      const createdDiscount = await tx.discount.create({
        data: {
          saleInvoiceId: invoice.id,
          scope: DiscountScope.ORDER,
          type: orderDiscount.type,
          value: orderDiscount.value
        },
        select: { id: true }
      });

      for (let lineIdx = 0; lineIdx < createdLines.length; lineIdx += 1) {
        const amount = round2(orderDiscount.allocations[lineIdx] ?? 0);
        if (amount <= 0) continue;
        await tx.discountAllocation.create({
          data: {
            discountId: createdDiscount.id,
            saleInvoiceLineId: createdLines[lineIdx].id,
            amount
          }
        });
      }
    }

    const createdInvoice = await tx.saleInvoice.findUnique({
      where: { id: invoice.id },
      include: saleInvoiceInclude
    });
    if (!createdInvoice) {
      throw new NotFoundException('Invoice not found after creation');
    }

    await this.stock.recordStock(
      tx,
      computedLines.map((line) => ({
        branchId: input.branchId,
        itemId: line.itemId,
        txnType: StockTxnType.SALE,
        qtyIn: 0,
        qtyOut: line.qty,
        referenceType: 'SALE',
        referenceId: invoice.id
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
            : await this.settleSaleInTx(tx, session, created.id, input.payments);
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
        return result;
      });
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
    return { invoice: await invoice, receipt };
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
        include: { lines: { select: { itemId: true, qty: true } } }
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
      await this.stock.recordStock(
        tx,
        invoice.lines.map((line) => ({
          branchId: invoice.branchId,
          itemId: line.itemId,
          txnType: StockTxnType.SALE_CANCEL,
          qtyIn: toNumber(line.qty),
          qtyOut: 0,
          referenceType: 'SALE_CANCEL',
          referenceId: invoice.id
        }))
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
      return updated;
    });
  }

  async settleSale(session: SessionUser, invoiceId: string, payments: PaymentInput[]) {
    return this.prisma.$transaction((tx) => this.settleSaleInTx(tx, session, invoiceId, payments));
  }

  /** Records payments against an unpaid invoice, inside the caller's transaction. */
  private async settleSaleInTx(tx: Prisma.TransactionClient, session: SessionUser, invoiceId: string, payments: PaymentInput[]) {
    const sessionBranchId = requireSessionBranchId(session);
    if (payments.length === 0 || payments.some((p) => !Number.isFinite(p.amount) || p.amount <= 0)) {
      throw new BadRequestException('Each payment amount must be greater than zero');
    }
    if (payments.some((p) => p.tendered !== undefined && (p.mode !== PaymentMode.CASH || !(round2(p.tendered) >= round2(p.amount))))) {
      throw new BadRequestException('Cash tendered is for cash payments, and at least the amount paid');
    }
    // Lock the invoice so two settle requests for it run one after the other.
    await tx.$queryRaw`SELECT id FROM "SaleInvoice" WHERE id = ${invoiceId} FOR UPDATE`;
    const invoice = await tx.saleInvoice.findUnique({
      where: { id: invoiceId },
      include: {
        ...saleInvoiceInclude,
        customer: true
      }
    });

    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.branchId !== sessionBranchId) throw new BadRequestException('Branch mismatch');
    if (invoice.status === InvoiceStatus.SETTLED) {
      throw new BadRequestException(`Invoice ${invoice.invoiceNo} is already paid`);
    }
    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestException(`Invoice ${invoice.invoiceNo} is cancelled`);
    }

    const payTotal = round2(payments.reduce((acc, p) => acc + p.amount, 0));
    const pending = invoiceDue({
      grandTotal: toNumber(invoice.grandTotal),
      paidTotal: toNumber(invoice.paidTotal),
      creditedTotal: toNumber(invoice.creditedTotal)
    });
    const excess = round2(Math.max(0, payTotal - pending));

    if (payTotal > pending && invoice.customer.isWalkIn) {
      throw new BadRequestException('Payment exceeds pending amount');
    }

    // All WALLET lines together; the wallet can pay at most what is due, so extra
    // money credited back to a wallet only ever comes from cash or card.
    const walletTotal = round2(
      payments.filter((p) => p.mode === PaymentMode.WALLET).reduce((acc, p) => acc + p.amount, 0)
    );
    if (walletTotal > 0) {
      this.customers.assertHasWallet(invoice.customer);
    }
    if (walletTotal > pending) {
      throw new BadRequestException('Wallet payment can\'t be more than the amount due');
    }
    if (isFallback() && (walletTotal > 0 || excess > 0)) {
      throw new BadRequestException("While working offline, the wallet can't be used: take cash or card, no more than is due.");
    }
    if (walletTotal > 0) {
      const wallet = await tx.walletAccount.findUnique({ where: { customerId: invoice.customerId } });
      if (!wallet) throw new NotFoundException('Wallet not found');
      // Debit only if the balance still covers it, so two sales can't spend the same money.
      const debited = await tx.walletAccount.updateMany({
        where: { id: wallet.id, balance: { gte: walletTotal } },
        data: { balance: { decrement: walletTotal } }
      });
      if (debited.count === 0) {
        throw new BadRequestException('Insufficient wallet balance');
      }
      await tx.walletTxn.create({
        data: {
          walletAccountId: wallet.id,
          type: WalletTxnType.DEBIT_SALE,
          amount: walletTotal,
          referenceType: 'SALE',
          referenceId: invoice.id,
          ...(await walletTxnAuthor(tx, session))
        }
      });
    }

    await this.registers.assertRegisterOpen(tx, session);
    await tx.payment.createMany({
      data: payments.map((p) => ({
        invoiceId: invoice.id,
        mode: p.mode,
        amount: p.amount,
        tendered: p.tendered !== undefined && round2(p.tendered) > round2(p.amount) ? round2(p.tendered) : null,
        reference: p.reference,
        registerSessionId: session.registerId
      }))
    });

    const appliedToInvoice = round2(Math.min(payTotal, pending));
    const updatedPaid = round2(toNumber(invoice.paidTotal) + appliedToInvoice);
    const status = round2(updatedPaid + toNumber(invoice.creditedTotal)) >= toNumber(invoice.grandTotal) ? InvoiceStatus.SETTLED : InvoiceStatus.PARTIALLY_SETTLED;

    const updated = await tx.saleInvoice.update({
      where: { id: invoice.id },
      data: { paidTotal: updatedPaid, status },
      include: saleInvoiceInclude
    });

    const seq = await this.sequences.nextSequence(invoice.branchId, 'receipt', tx);
    const receiptNo = `${seq.prefix}-${seq.branchCode}-${String(seq.seq).padStart(6, '0')}`;

    const receipt = await tx.receipt.create({
      data: {
        receiptNo,
        invoiceId: invoice.id,
        amount: payTotal
      }
    });

    if (excess > 0 && !invoice.customer.isWalkIn) {
      const wallet = await tx.walletAccount.findUnique({ where: { customerId: invoice.customerId } });
      if (!wallet) throw new NotFoundException('Wallet not found');

      await tx.walletAccount.update({
        where: { id: wallet.id },
        data: { balance: { increment: excess } }
      });
      await tx.walletTxn.create({
        data: {
          walletAccountId: wallet.id,
          type: WalletTxnType.TOPUP,
          amount: excess,
          referenceType: 'SALE',
          referenceId: invoice.id,
          ...(await walletTxnAuthor(tx, session))
        }
      });
    }

    const invoiceWithCreatorName = await updated;
    return { invoice: invoiceWithCreatorName, receipt };
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

  async listSales(branchId: string) {
    const invoices = await this.prisma.saleInvoice.findMany({
      where: { branchId },
      orderBy: { createdAt: 'desc' },
      include: {
        discounts: true
      }
    });
    return invoices;
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
        discounts: true
      }
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
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
