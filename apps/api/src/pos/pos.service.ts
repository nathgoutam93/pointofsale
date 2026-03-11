import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, PaymentMode, Prisma, StockTxnType, UserRole, WalletTxnType } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { PaymentInput, SessionUser } from './pos.types';

@Injectable()
export class PosService {
  constructor(private readonly prisma: PrismaService) {}

  private async withCreatedByName<T extends { createdBy: string }>(
    invoice: T
  ): Promise<T & { createdByName: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: invoice.createdBy },
      select: { username: true }
    });
    return {
      ...invoice,
      createdByName: user?.username ?? 'Unknown User'
    };
  }

  private async withCreatedByNames<T extends { createdBy: string }>(
    invoices: T[]
  ): Promise<Array<T & { createdByName: string }>> {
    const userIds = Array.from(new Set(invoices.map((invoice) => invoice.createdBy)));
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true }
    });
    const usernameById = new Map(users.map((user) => [user.id, user.username]));

    return invoices.map((invoice) => ({
      ...invoice,
      createdByName: usernameById.get(invoice.createdBy) ?? 'Unknown User'
    }));
  }

  private async ensureBranchExists(branchId: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    const branch = await client.branch.findUnique({ where: { id: branchId }, select: { id: true } });
    if (!branch) {
      throw new BadRequestException(`Invalid branchId: ${branchId}`);
    }
  }

  private async resolveItemId(itemRef: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    const item = await client.item.findFirst({
      where: {
        OR: [{ id: itemRef }, { code: itemRef }]
      },
      select: { id: true }
    });

    if (!item) {
      throw new BadRequestException(`Invalid itemId/item code: ${itemRef}`);
    }

    return item.id;
  }

  async onModuleInitSeed() {
    const branch = await this.prisma.branch.upsert({
      where: { code: 'MAIN' },
      update: {},
      create: { name: 'Main Branch', code: 'MAIN' }
    });

    await this.prisma.user.upsert({
      where: { username: 'admin' },
      update: {},
      create: { username: 'admin', password: 'password', role: UserRole.ADMIN, branchId: branch.id }
    });

    await this.prisma.user.upsert({
      where: { username: 'cashier' },
      update: {},
      create: { username: 'cashier', password: 'password', role: UserRole.CASHIER, branchId: branch.id }
    });

    await this.ensureWalkInCustomer(branch.id);
  }

  private toNumber(value: Prisma.Decimal | number | null | undefined) {
    return Number(value ?? 0);
  }

  private round2(value: number) {
    return Math.round(value * 100) / 100;
  }

  private async nextSequence(branchId: string, type: 'invoice' | 'receipt' | 'return' | 'customer', tx: Prisma.TransactionClient) {
    const field =
      type === 'invoice'
        ? 'invoiceSeq'
        : type === 'receipt'
          ? 'receiptSeq'
          : type === 'return'
            ? 'returnSeq'
            : 'customerSeq';

    const branch = await tx.branch.update({
      where: { id: branchId },
      data: { [field]: { increment: 1 } }
    });

    return {
      branchCode: branch.code,
      seq: (branch as any)[field] as number
    };
  }

  private async ensureWalkInCustomer(branchId: string) {
    const existing = await this.prisma.customer.findFirst({ where: { branchId, isWalkIn: true } });
    if (existing) return existing;

    const sequence = await this.prisma.$transaction(async (tx) => {
      const seq = await this.nextSequence(branchId, 'customer', tx);
      const customer = await tx.customer.create({
        data: {
          branchId,
          code: `CUST-${seq.branchCode}-${String(seq.seq).padStart(6, '0')}`,
          name: 'Walk In Customer',
          isWalkIn: true
        }
      });

      await tx.walletAccount.create({
        data: {
          customerId: customer.id,
          branchId,
          balance: 0
        }
      });

      return customer;
    });

    return sequence;
  }

  async login(username: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user || user.password !== password) {
      throw new BadRequestException('Invalid credentials');
    }

    const token = Buffer.from(`${user.id}:${user.role}:${user.branchId}`).toString('base64');
    return { token, userId: user.id, username: user.username, role: user.role, branchId: user.branchId };
  }

  async me(session: SessionUser) {
    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
      select: { username: true }
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return { ...session, username: user.username };
  }

  async listCustomers(branchId: string) {
    return this.prisma.customer.findMany({ where: { branchId }, orderBy: { createdAt: 'desc' } });
  }

  async createCustomer(branchId: string, name: string, phone?: string) {
    return this.prisma.$transaction(async (tx) => {
      const seq = await this.nextSequence(branchId, 'customer', tx);
      const customer = await tx.customer.create({
        data: {
          branchId,
          code: `CUST-${seq.branchCode}-${String(seq.seq).padStart(6, '0')}`,
          name,
          phone
        }
      });

      await tx.walletAccount.create({
        data: {
          customerId: customer.id,
          branchId,
          balance: 0
        }
      });

      return customer;
    });
  }

  async getWalkIn(branchId: string) {
    return this.ensureWalkInCustomer(branchId);
  }

  async getWallet(customerId: string) {
    const wallet = await this.prisma.walletAccount.findUnique({ where: { customerId } });
    if (!wallet) throw new NotFoundException('Wallet not found');
    return { customerId, branchId: wallet.branchId, balance: this.toNumber(wallet.balance) };
  }

  async topupWallet(customerId: string, amount: number, reference?: string) {
    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.walletAccount.findUnique({ where: { customerId } });
      if (!wallet) throw new NotFoundException('Wallet not found');

      await tx.walletAccount.update({
        where: { id: wallet.id },
        data: { balance: { increment: amount } }
      });

      return tx.walletTxn.create({
        data: {
          walletAccountId: wallet.id,
          type: WalletTxnType.TOPUP,
          amount,
          referenceType: 'TOPUP',
          referenceId: reference
        }
      });
    });
  }

  async listItems(activeOnly?: boolean) {
    return this.prisma.item.findMany({ where: activeOnly ? { isActive: true } : undefined, orderBy: { createdAt: 'desc' } });
  }

  async createItem(input: {
    code: string;
    name: string;
    category?: string;
    uom: string;
    costPrice?: number;
    sellPrice: number;
    taxMode?: 'INCLUSIVE' | 'EXCLUSIVE';
    taxRate: number;
    imageUrl?: string;
  }) {
    return this.prisma.item.create({
      data: {
        ...input,
        costPrice: input.costPrice ?? 0,
        taxMode: input.taxMode ?? 'EXCLUSIVE'
      }
    });
  }

  async updateItem(
    id: string,
    input: {
      name?: string;
      category?: string | null;
      uom?: string;
      costPrice?: number;
      sellPrice?: number;
      taxMode?: 'INCLUSIVE' | 'EXCLUSIVE';
      taxRate?: number;
      imageUrl?: string | null;
      isActive?: boolean;
    }
  ) {
    return this.prisma.item.update({ where: { id }, data: input });
  }

  async deleteItem(id: string) {
    const salesCount = await this.prisma.saleInvoiceLine.count({ where: { itemId: id } });
    if (salesCount > 0) {
      throw new BadRequestException('Cannot delete item with sales history');
    }

    return this.prisma.item.update({
      where: { id },
      data: { isActive: false }
    });
  }

  async createStockOpening(branchId: string, itemId: string, qty: number, costPrice?: number, reason?: string) {
    await this.ensureBranchExists(branchId);
    const normalizedItemId = await this.resolveItemId(itemId);

    const existingOpening = await this.prisma.stockLedger.findFirst({
      where: {
        branchId,
        itemId: normalizedItemId,
        txnType: StockTxnType.OPENING
      }
    });

    if (existingOpening) {
      throw new BadRequestException('Opening stock already exists for this item');
    }

    try {
      return await this.prisma.stockLedger.create({
        data: {
          branchId,
          itemId: normalizedItemId,
          txnType: StockTxnType.OPENING,
          qtyIn: qty,
          qtyOut: 0,
          costPrice: costPrice ?? 0,
          reason
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('Opening stock already exists for this item');
      }
      throw error;
    }
  }

  async updateStockOpening(branchId: string, itemId: string, qty: number, costPrice?: number, reason?: string) {
    await this.ensureBranchExists(branchId);
    const normalizedItemId = await this.resolveItemId(itemId);

    return this.prisma.$transaction(async (tx) => {
      const opening = await tx.stockLedger.findFirst({
        where: {
          branchId,
          itemId: normalizedItemId,
          txnType: StockTxnType.OPENING
        }
      });

      if (!opening) {
        throw new NotFoundException('Opening stock does not exist for this item');
      }

      const currentOnHand = await this.getOnHandForItem(branchId, normalizedItemId, tx);
      const openingQty = this.toNumber(opening.qtyIn);
      const newOnHand = this.round2(currentOnHand - openingQty + qty);

      if (newOnHand < 0) {
        throw new BadRequestException('Opening qty cannot be less than already consumed stock');
      }

      return tx.stockLedger.update({
        where: { id: opening.id },
        data: {
          qtyIn: qty,
          qtyOut: 0,
          costPrice: costPrice ?? this.toNumber(opening.costPrice),
          reason
        }
      });
    });
  }

  async createStockAdjustment(branchId: string, itemId: string, qty: number, direction: 'IN' | 'OUT', costPrice: number | undefined, reason: string) {
    await this.ensureBranchExists(branchId);
    const normalizedItemId = await this.resolveItemId(itemId);

    if (direction === 'OUT') {
      const onHand = await this.getOnHandForItem(branchId, normalizedItemId);
      if (onHand < qty) throw new BadRequestException('Insufficient stock for adjustment out');
    }

    return this.prisma.stockLedger.create({
      data: {
        branchId,
        itemId: normalizedItemId,
        txnType: direction === 'IN' ? StockTxnType.ADJUSTMENT_PLUS : StockTxnType.ADJUSTMENT_MINUS,
        qtyIn: direction === 'IN' ? qty : 0,
        qtyOut: direction === 'OUT' ? qty : 0,
        costPrice: costPrice ?? 0,
        reason
      }
    });
  }

  private async getOnHandForItem(branchId: string, itemId: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    const rows = await client.stockLedger.findMany({ where: { branchId, itemId }, select: { qtyIn: true, qtyOut: true } });
    return rows.reduce((acc, row) => acc + this.toNumber(row.qtyIn) - this.toNumber(row.qtyOut), 0);
  }

  async getOnHand(branchId: string, itemId?: string) {
    await this.ensureBranchExists(branchId);
    const normalizedItemId = itemId ? await this.resolveItemId(itemId) : undefined;

    const rows = await this.prisma.stockLedger.findMany({
      where: { branchId, ...(normalizedItemId ? { itemId: normalizedItemId } : {}) },
      select: { itemId: true, qtyIn: true, qtyOut: true }
    });

    const grouped = rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.itemId] = (acc[row.itemId] ?? 0) + this.toNumber(row.qtyIn) - this.toNumber(row.qtyOut);
      return acc;
    }, {});

    return Object.entries(grouped).map(([id, onHand]) => ({ itemId: id, onHand }));
  }

  async getLedger(branchId: string, itemId?: string) {
    await this.ensureBranchExists(branchId);
    const normalizedItemId = itemId ? await this.resolveItemId(itemId) : undefined;
    return this.prisma.stockLedger.findMany({
      where: { branchId, ...(normalizedItemId ? { itemId: normalizedItemId } : {}) },
      orderBy: { createdAt: 'desc' }
    });
  }

  async createSale(
    session: SessionUser,
    input: { branchId: string; customerId: string; lines: Array<{ itemId: string; qty: number; rate: number; discountAmount?: number; taxRate: number }> }
  ) {
    if (session.branchId !== input.branchId) {
      throw new BadRequestException('Branch mismatch');
    }

    return this.prisma.$transaction(async (tx) => {
      await this.ensureBranchExists(input.branchId, tx);
      const normalizedLines = [];

      for (const line of input.lines) {
        const normalizedItemId = await this.resolveItemId(line.itemId, tx);
        const onHand = await this.getOnHandForItem(input.branchId, normalizedItemId, tx);
        if (onHand < line.qty) {
          throw new BadRequestException(`Insufficient stock for item ${line.itemId}`);
        }
        normalizedLines.push({ ...line, itemId: normalizedItemId });
      }

      const seq = await this.nextSequence(input.branchId, 'invoice', tx);
      const invoiceNo = `INV-${seq.branchCode}-${String(seq.seq).padStart(6, '0')}`;

      const computedLines = normalizedLines.map((line) => {
        const gross = line.qty * line.rate;
        const discount = line.discountAmount ?? 0;
        const taxable = this.round2(gross - discount);
        const tax = this.round2((taxable * line.taxRate) / 100);
        const net = this.round2(taxable + tax);
        return {
          ...line,
          discountAmount: discount,
          taxableAmount: taxable,
          taxAmount: tax,
          netAmount: net
        };
      });

      const subTotal = this.round2(computedLines.reduce((acc, l) => acc + l.qty * l.rate, 0));
      const discountTotal = this.round2(computedLines.reduce((acc, l) => acc + l.discountAmount, 0));
      const taxTotal = this.round2(computedLines.reduce((acc, l) => acc + l.taxAmount, 0));
      const grandTotal = this.round2(computedLines.reduce((acc, l) => acc + l.netAmount, 0));

      const invoice = await tx.saleInvoice.create({
        data: {
          branchId: input.branchId,
          invoiceNo,
          customerId: input.customerId,
          status: InvoiceStatus.DRAFT,
          subTotal,
          discountTotal,
          taxTotal,
          grandTotal,
          paidTotal: 0,
          createdBy: session.userId,
          lines: {
            create: computedLines.map((l) => ({
              itemId: l.itemId,
              qty: l.qty,
              rate: l.rate,
              discountAmount: l.discountAmount,
              taxRate: l.taxRate,
              taxableAmount: l.taxableAmount,
              taxAmount: l.taxAmount,
              netAmount: l.netAmount
            }))
          }
        },
        include: { lines: true, payments: true }
      });

      await tx.stockLedger.createMany({
        data: computedLines.map((line) => ({
          branchId: input.branchId,
          itemId: line.itemId,
          txnType: StockTxnType.SALE,
          qtyIn: 0,
          qtyOut: line.qty,
          referenceType: 'SALE',
          referenceId: invoice.id
        }))
      });

      return this.withCreatedByName(invoice);
    });
  }

  async settleSale(session: SessionUser, invoiceId: string, payments: PaymentInput[]) {
    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.saleInvoice.findUnique({
        where: { id: invoiceId },
        include: { lines: true, payments: true, customer: true }
      });

      if (!invoice) throw new NotFoundException('Invoice not found');
      if (invoice.branchId !== session.branchId) throw new BadRequestException('Branch mismatch');

      const payTotal = this.round2(payments.reduce((acc, p) => acc + p.amount, 0));
      const pending = this.round2(this.toNumber(invoice.grandTotal) - this.toNumber(invoice.paidTotal));
      const excess = this.round2(Math.max(0, payTotal - pending));

      if (payTotal > pending && invoice.customer.isWalkIn) {
        throw new BadRequestException('Payment exceeds pending amount');
      }

      const walletPayment = payments.find((p) => p.mode === PaymentMode.WALLET);
      if (walletPayment) {
        const wallet = await tx.walletAccount.findUnique({ where: { customerId: invoice.customerId } });
        if (!wallet) throw new NotFoundException('Wallet not found');
        if (this.toNumber(wallet.balance) < walletPayment.amount) {
          throw new BadRequestException('Insufficient wallet balance');
        }

        await tx.walletAccount.update({ where: { id: wallet.id }, data: { balance: { decrement: walletPayment.amount } } });
        await tx.walletTxn.create({
          data: {
            walletAccountId: wallet.id,
            type: WalletTxnType.DEBIT_SALE,
            amount: walletPayment.amount,
            referenceType: 'SALE',
            referenceId: invoice.id
          }
        });
      }

      await tx.payment.createMany({
        data: payments.map((p) => ({
          invoiceId: invoice.id,
          mode: p.mode,
          amount: p.amount,
          reference: p.reference
        }))
      });

      const appliedToInvoice = this.round2(Math.min(payTotal, pending));
      const updatedPaid = this.round2(this.toNumber(invoice.paidTotal) + appliedToInvoice);
      const status = updatedPaid >= this.toNumber(invoice.grandTotal) ? InvoiceStatus.SETTLED : InvoiceStatus.PARTIALLY_SETTLED;

      const updated = await tx.saleInvoice.update({
        where: { id: invoice.id },
        data: { paidTotal: updatedPaid, status },
        include: { lines: true, payments: true }
      });

      const seq = await this.nextSequence(invoice.branchId, 'receipt', tx);
      const receiptNo = `RCPT-${seq.branchCode}-${String(seq.seq).padStart(6, '0')}`;

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
            referenceId: invoice.id
          }
        });
      }

      const invoiceWithCreatorName = await this.withCreatedByName(updated);
      return { invoice: invoiceWithCreatorName, receipt };
    });
  }

  async listSales(branchId: string) {
    const invoices = await this.prisma.saleInvoice.findMany({
      where: { branchId },
      orderBy: { createdAt: 'desc' }
    });
    return this.withCreatedByNames(invoices);
  }

  async getSaleById(id: string) {
    const invoice = await this.prisma.saleInvoice.findUnique({ where: { id }, include: { lines: true, payments: true } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return this.withCreatedByName(invoice);
  }

  async createReturn(session: SessionUser, saleInvoiceId: string, input: { lines: Array<{ saleLineId: string; qty: number }>; refundMode: PaymentMode }) {
    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.saleInvoice.findUnique({
        where: { id: saleInvoiceId },
        include: { lines: { include: { returnLines: true } } }
      });

      if (!invoice) throw new NotFoundException('Invoice not found');
      if (invoice.branchId !== session.branchId) throw new BadRequestException('Branch mismatch');

      let totalAmount = 0;
      const returnLineCreates: Array<{ saleLineId: string; qty: number; amount: number }> = [];

      for (const reqLine of input.lines) {
        const saleLine = invoice.lines.find((l) => l.id === reqLine.saleLineId);
        if (!saleLine) throw new BadRequestException(`Sale line not found: ${reqLine.saleLineId}`);

        const alreadyReturned = saleLine.returnLines.reduce((acc, rl) => acc + this.toNumber(rl.qty), 0);
        const soldQty = this.toNumber(saleLine.qty);
        if (alreadyReturned + reqLine.qty > soldQty) {
          throw new BadRequestException(`Return qty exceeds sold qty for line ${saleLine.id}`);
        }

        const perQty = this.round2(this.toNumber(saleLine.netAmount) / soldQty);
        const amount = this.round2(perQty * reqLine.qty);
        totalAmount = this.round2(totalAmount + amount);
        returnLineCreates.push({ saleLineId: saleLine.id, qty: reqLine.qty, amount });
      }

      const seq = await this.nextSequence(invoice.branchId, 'return', tx);
      const returnNo = `RTN-${seq.branchCode}-${String(seq.seq).padStart(6, '0')}`;

      const returnInvoice = await tx.returnInvoice.create({
        data: {
          saleInvoiceId,
          returnNo,
          totalAmount,
          refundMode: input.refundMode,
          lines: { create: returnLineCreates }
        }
      });

      for (const line of returnLineCreates) {
        const saleLine = invoice.lines.find((l) => l.id === line.saleLineId)!;
        await tx.stockLedger.create({
          data: {
            branchId: invoice.branchId,
            itemId: saleLine.itemId,
            txnType: StockTxnType.RETURN,
            qtyIn: line.qty,
            qtyOut: 0,
            referenceType: 'RETURN',
            referenceId: returnInvoice.id
          }
        });
      }

      if (input.refundMode === PaymentMode.WALLET) {
        const wallet = await tx.walletAccount.findUnique({ where: { customerId: invoice.customerId } });
        if (!wallet) throw new NotFoundException('Wallet not found');

        await tx.walletAccount.update({ where: { id: wallet.id }, data: { balance: { increment: totalAmount } } });
        await tx.walletTxn.create({
          data: {
            walletAccountId: wallet.id,
            type: WalletTxnType.REFUND_RETURN,
            amount: totalAmount,
            referenceType: 'RETURN',
            referenceId: returnInvoice.id
          }
        });
      }

      return returnInvoice;
    });
  }

  async getReceiptById(id: string) {
    const receipt = await this.prisma.receipt.findUnique({ where: { id } });
    if (!receipt) throw new NotFoundException('Receipt not found');
    return receipt;
  }

  async getReceiptsByInvoice(invoiceId: string) {
    const key = invoiceId.trim();
    const receiptsById = await this.prisma.receipt.findMany({
      where: { invoiceId: key },
      orderBy: { createdAt: 'desc' }
    });
    if (receiptsById.length > 0) return receiptsById;

    const receiptsByInvoiceNo = await this.prisma.receipt.findMany({
      where: { invoice: { invoiceNo: key } },
      orderBy: { createdAt: 'desc' }
    });

    if (receiptsByInvoiceNo.length > 0) return receiptsByInvoiceNo;

    throw new NotFoundException('Receipt not found for given invoice id/number');
  }

  private startOfDay(date: Date) {
    const value = new Date(date);
    value.setHours(0, 0, 0, 0);
    return value;
  }

  private startOfWeek(date: Date) {
    const value = this.startOfDay(date);
    const day = value.getDay();
    const diff = (day + 6) % 7;
    value.setDate(value.getDate() - diff);
    return value;
  }

  private startOfMonth(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  private addDays(date: Date, days: number) {
    const value = new Date(date);
    value.setDate(value.getDate() + days);
    return value;
  }

  private addMonths(date: Date, months: number) {
    return new Date(date.getFullYear(), date.getMonth() + months, 1);
  }

  private async computeReportRange(
    branchId: string,
    range: { label: string; startDate: Date | null; endDate: Date | null }
  ) {
    const createdAt =
      range.startDate && range.endDate
        ? {
            gte: range.startDate,
            lt: range.endDate
          }
        : undefined;

    const salesWhere: Prisma.SaleInvoiceWhereInput = {
      branchId,
      status: { not: InvoiceStatus.CANCELLED },
      ...(createdAt ? { createdAt } : {})
    };
    const returnsWhere: Prisma.ReturnInvoiceWhereInput = {
      saleInvoice: { branchId },
      ...(createdAt ? { createdAt } : {})
    };
    const expensesWhere: Prisma.StockLedgerWhereInput = {
      branchId,
      txnType: { in: [StockTxnType.OPENING, StockTxnType.ADJUSTMENT_PLUS] },
      ...(createdAt ? { createdAt } : {})
    };

    const [salesAgg, returnsAgg, expenseRows] = await Promise.all([
      this.prisma.saleInvoice.aggregate({
        where: salesWhere,
        _sum: { grandTotal: true }
      }),
      this.prisma.returnInvoice.aggregate({
        where: returnsWhere,
        _sum: { totalAmount: true }
      }),
      this.prisma.stockLedger.findMany({
        where: expensesWhere,
        select: { qtyIn: true, costPrice: true }
      })
    ]);

    const salesTotal = this.toNumber(salesAgg._sum.grandTotal);
    const returnsTotal = this.toNumber(returnsAgg._sum.totalAmount);
    const expensesTotal = this.round2(
      expenseRows.reduce((acc, row) => acc + this.toNumber(row.qtyIn) * this.toNumber(row.costPrice), 0)
    );
    const netSales = this.round2(salesTotal - returnsTotal);
    const profit = this.round2(netSales - expensesTotal);

    return {
      label: range.label,
      startDate: range.startDate ? range.startDate.toISOString() : null,
      endDate: range.endDate ? range.endDate.toISOString() : null,
      salesTotal: this.round2(salesTotal),
      returnsTotal: this.round2(returnsTotal),
      expensesTotal,
      netSales,
      profit
    };
  }

  async getSalesSummary(session: SessionUser, branchId: string) {
    if (session.branchId !== branchId) {
      throw new BadRequestException('Branch mismatch');
    }
    await this.ensureBranchExists(branchId);

    const now = new Date();
    const todayStart = this.startOfDay(now);
    const weekStart = this.startOfWeek(now);
    const monthStart = this.startOfMonth(now);

    const ranges = [
      {
        label: 'Today',
        startDate: todayStart,
        endDate: this.addDays(todayStart, 1)
      },
      {
        label: 'This Week',
        startDate: weekStart,
        endDate: this.addDays(weekStart, 7)
      },
      {
        label: 'This Month',
        startDate: monthStart,
        endDate: this.addMonths(monthStart, 1)
      },
      {
        label: 'Overall',
        startDate: null,
        endDate: null
      }
    ];

    const summaries = await Promise.all(ranges.map((range) => this.computeReportRange(branchId, range)));

    return {
      branchId,
      generatedAt: now.toISOString(),
      ranges: summaries
    };
  }
}
