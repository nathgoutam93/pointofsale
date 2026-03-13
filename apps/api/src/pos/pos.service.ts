import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, PaymentMode, Prisma, StockTxnType, UserRole, WalletTxnType } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { PaymentInput, SessionUser } from './pos.types';

type SaleLineInput = {
  itemId: string;
  qty: number;
  rate: number;
  discountAmount?: number;
  taxRate: number;
};

type ComputedSaleLine = SaleLineInput & {
  discountAmount: number;
  taxableAmount: number;
  taxAmount: number;
  netAmount: number;
  grossAmount: number;
  itemDiscountAmount: number;
  orderDiscountAmount: number;
};

@Injectable()
export class PosService {
  constructor(private readonly prisma: PrismaService) {}
  private readonly branchSummarySelect = {
    id: true,
    name: true,
    code: true
  } as const;

  private readonly businessSettingsSelect = {
    id: true,
    name: true,
    logoUrl: true,
    gstNumber: true
  } as const;

  private readonly branchSettingsSelect = {
    id: true,
    name: true,
    code: true,
    logoUrl: true,
    invoicePrefix: true,
    receiptPrefix: true,
    returnPrefix: true,
    invoiceHeader: true,
    invoiceFooter: true,
    receiptHeader: true,
    receiptFooter: true,
    invoiceCss: true,
    receiptCss: true
  } as const;

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

  private requireSessionBranchId(session: SessionUser) {
    if (!session.branchId) {
      throw new BadRequestException('Branch not selected. Open a register first.');
    }
    return session.branchId;
  }

  private requireSessionRegisterId(session: SessionUser) {
    if (!session.registerId) {
      throw new BadRequestException('Register is not open.');
    }
    return session.registerId;
  }

  private async ensureUserHasBranchAccess(userId: string, branchId: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    const access = await client.userBranchAccess.findUnique({
      where: { userId_branchId: { userId, branchId } },
      select: { id: true }
    });
    if (!access) {
      throw new BadRequestException('You do not have access to this branch');
    }
  }

  private buildToken(session: SessionUser) {
    const parts = [session.userId, session.role];
    if (session.branchId) {
      parts.push(session.branchId);
    }
    if (session.registerId) {
      parts.push(session.registerId);
    }
    return Buffer.from(parts.join(':')).toString('base64');
  }

  private async ensureBusinessSettings(tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    return client.businessSettings.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default', name: 'My Business' },
      select: this.businessSettingsSelect
    });
  }

  async getBusinessSettings() {
    return this.ensureBusinessSettings();
  }

  async updateBusinessSettings(input: { name?: string; logoUrl?: string | null; gstNumber?: string | null }) {
    await this.ensureBusinessSettings();
    return this.prisma.businessSettings.update({
      where: { id: 'default' },
      data: {
        name: input.name,
        logoUrl: input.logoUrl,
        gstNumber: input.gstNumber
      },
      select: this.businessSettingsSelect
    });
  }

  async getBranchSettings(branchId: string) {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: this.branchSettingsSelect
    });
    if (!branch) {
      throw new NotFoundException('Branch not found');
    }
    return branch;
  }

  async updateBranchSettings(
    branchId: string,
    input: {
      name?: string;
      code?: string;
      logoUrl?: string | null;
      invoicePrefix?: string;
      receiptPrefix?: string;
      returnPrefix?: string;
      invoiceHeader?: string | null;
      invoiceFooter?: string | null;
      receiptHeader?: string | null;
      receiptFooter?: string | null;
      invoiceCss?: string | null;
      receiptCss?: string | null;
    }
  ) {
    await this.ensureBranchExists(branchId);
    return this.prisma.branch.update({
      where: { id: branchId },
      data: {
        name: input.name,
        code: input.code,
        logoUrl: input.logoUrl,
        invoicePrefix: input.invoicePrefix,
        receiptPrefix: input.receiptPrefix,
        returnPrefix: input.returnPrefix,
        invoiceHeader: input.invoiceHeader,
        invoiceFooter: input.invoiceFooter,
        receiptHeader: input.receiptHeader,
        receiptFooter: input.receiptFooter,
        invoiceCss: input.invoiceCss,
        receiptCss: input.receiptCss
      },
      select: this.branchSettingsSelect
    });
  }

  async createBranch(session: SessionUser, input: { name: string; code: string }) {
    const name = input.name.trim();
    const code = input.code.trim().toUpperCase();

    if (!name) {
      throw new BadRequestException('Branch name is required');
    }
    if (!code) {
      throw new BadRequestException('Branch code is required');
    }

    try {
      const branch = await this.prisma.$transaction(async (tx) => {
        const created = await tx.branch.create({
          data: { name, code },
          select: this.branchSummarySelect
        });

        const adminUsers = await tx.user.findMany({
          where: { role: UserRole.ADMIN },
          select: { id: true }
        });

        await Promise.all(
          adminUsers.map((admin) =>
            tx.userBranchAccess.upsert({
              where: { userId_branchId: { userId: admin.id, branchId: created.id } },
              update: {},
              create: { userId: admin.id, branchId: created.id }
            })
          )
        );

        await tx.userBranchAccess.upsert({
          where: { userId_branchId: { userId: session.userId, branchId: created.id } },
          update: {},
          create: { userId: session.userId, branchId: created.id }
        });

        return created;
      });

      await this.ensureWalkInCustomer(branch.id);
      return branch;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('Branch code already exists');
      }
      throw error;
    }
  }

  async listUsers(branchId: string) {
    await this.ensureBranchExists(branchId);
    const users = await this.prisma.user.findMany({
      where: { branchAccesses: { some: { branchId } } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        username: true,
        role: true,
        branchId: true,
        isActive: true,
        createdAt: true,
        branchAccesses: { select: { branchId: true } }
      }
    });
    return users.map((user) => ({
      id: user.id,
      username: user.username,
      role: user.role,
      branchId: user.branchId,
      branchIds: user.branchAccesses.map((access) => access.branchId),
      isActive: user.isActive,
      createdAt: user.createdAt
    }));
  }

  async createUser(
    branchId: string,
    input: { username: string; password: string; role?: UserRole; branchIds?: string[] }
  ) {
    await this.ensureBranchExists(branchId);
    if (input.role && input.role !== UserRole.CASHIER) {
      throw new BadRequestException('Only cashier accounts can be created here');
    }
    const uniqueBranchIds = Array.from(new Set([branchId, ...(input.branchIds ?? [])]));
    await Promise.all(uniqueBranchIds.map((id) => this.ensureBranchExists(id)));
    const created = await this.prisma.user.create({
      data: {
        branchId,
        username: input.username,
        password: input.password,
        role: UserRole.CASHIER,
        branchAccesses: {
          createMany: {
            data: uniqueBranchIds.map((id) => ({ branchId: id }))
          }
        }
      },
      select: {
        id: true,
        username: true,
        role: true,
        branchId: true,
        isActive: true,
        createdAt: true,
        branchAccesses: { select: { branchId: true } }
      }
    });
    return {
      id: created.id,
      username: created.username,
      role: created.role,
      branchId: created.branchId,
      branchIds: created.branchAccesses.map((access) => access.branchId),
      isActive: created.isActive,
      createdAt: created.createdAt
    };
  }

  async grantUserBranchAccess(session: SessionUser, userId: string, branchId: string) {
    await this.ensureBranchExists(branchId);
    if (session.branchId) {
      await this.ensureUserHasBranchAccess(session.userId, session.branchId);
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.role !== UserRole.CASHIER) {
      throw new BadRequestException('Only cashier access updates are allowed');
    }

    await this.prisma.userBranchAccess.upsert({
      where: { userId_branchId: { userId, branchId } },
      update: {},
      create: { userId, branchId }
    });
  }

  async revokeUserBranchAccess(session: SessionUser, userId: string, branchId: string) {
    if (session.branchId) {
      await this.ensureUserHasBranchAccess(session.userId, session.branchId);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, branchId: true }
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.role !== UserRole.CASHIER) {
      throw new BadRequestException('Only cashier access updates are allowed');
    }
    if (user.branchId === branchId) {
      throw new BadRequestException('Cannot remove the user primary branch access');
    }

    await this.prisma.userBranchAccess.delete({
      where: { userId_branchId: { userId, branchId } }
    });
  }

  async updateUser(
    session: SessionUser,
    userId: string,
    input: { username?: string; password?: string; isActive?: boolean; role?: UserRole }
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { branchAccesses: { select: { branchId: true } } }
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (session.branchId && !user.branchAccesses.some((access) => access.branchId === session.branchId)) {
      throw new BadRequestException('Branch mismatch');
    }
    if (input.role && input.role !== UserRole.CASHIER) {
      throw new BadRequestException('Only cashier role updates are allowed');
    }
    if (input.isActive === false && user.id === session.userId) {
      throw new BadRequestException('Cannot deactivate your own account');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        username: input.username,
        password: input.password,
        isActive: input.isActive
      },
      select: {
        id: true,
        username: true,
        role: true,
        branchId: true,
        isActive: true,
        createdAt: true,
        branchAccesses: { select: { branchId: true } }
      }
    });
    return {
      id: updated.id,
      username: updated.username,
      role: updated.role,
      branchId: updated.branchId,
      branchIds: updated.branchAccesses.map((access) => access.branchId),
      isActive: updated.isActive,
      createdAt: updated.createdAt
    };
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

    const users = await this.prisma.user.findMany({ select: { id: true, branchId: true } });
    await Promise.all(
      users.map((user) =>
        this.prisma.userBranchAccess.upsert({
          where: { userId_branchId: { userId: user.id, branchId: user.branchId } },
          update: {},
          create: { userId: user.id, branchId: user.branchId }
        })
      )
    );

    await this.prisma.businessSettings.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default', name: branch.name }
    });

    await this.ensureWalkInCustomer(branch.id);
  }

  private toNumber(value: Prisma.Decimal | number | null | undefined) {
    return Number(value ?? 0);
  }

  private round2(value: number) {
    return Math.round(value * 100) / 100;
  }

  private allocateOrderDiscount(bases: number[], orderDiscountAmount: number) {
    const totalBase = this.round2(bases.reduce((acc, base) => acc + base, 0));
    const cappedDiscount = this.round2(Math.min(Math.max(0, orderDiscountAmount), totalBase));
    if (totalBase <= 0 || cappedDiscount <= 0) {
      return new Array(bases.length).fill(0);
    }

    const rawShares = bases.map((base) => (base / totalBase) * cappedDiscount);
    const floored = rawShares.map((share) => this.round2(Math.floor(share * 100) / 100));
    const fractions = rawShares.map((share, idx) => share - floored[idx]);
    let remainingCents = Math.round(this.round2(cappedDiscount - floored.reduce((acc, share) => acc + share, 0)) * 100);

    const order = bases
      .map((base, idx) => ({
        idx,
        frac: fractions[idx] ?? 0,
        headroom: this.round2(base - floored[idx])
      }))
      .filter((entry) => entry.headroom >= 0.01)
      .sort((a, b) => b.frac - a.frac || a.idx - b.idx);

    while (remainingCents > 0 && order.length > 0) {
      let progressed = false;
      for (const entry of order) {
        if (remainingCents <= 0) break;
        if (this.round2(bases[entry.idx] - floored[entry.idx]) < 0.01) continue;
        floored[entry.idx] = this.round2(floored[entry.idx] + 0.01);
        remainingCents -= 1;
        progressed = true;
      }
      if (!progressed) break;
    }

    return floored;
  }

  private calculateSaleTotals(lines: SaleLineInput[], orderDiscountAmount: number) {
    const normalized = lines.map((line) => {
      const gross = this.round2(line.qty * line.rate);
      const itemDiscount = this.round2(Math.min(Math.max(0, line.discountAmount ?? 0), gross));
      const base = this.round2(Math.max(0, gross - itemDiscount));
      return { line, gross, itemDiscount, base };
    });

    const allocations = this.allocateOrderDiscount(
      normalized.map((entry) => entry.base),
      orderDiscountAmount
    );

    const computedLines: ComputedSaleLine[] = normalized.map((entry, idx) => {
      const orderDiscount = this.round2(allocations[idx] ?? 0);
      const discountTotal = this.round2(entry.itemDiscount + orderDiscount);
      const taxable = this.round2(Math.max(0, entry.gross - discountTotal));
      const tax = this.round2((taxable * entry.line.taxRate) / 100);
      const net = this.round2(taxable + tax);
      return {
        ...entry.line,
        discountAmount: discountTotal,
        taxableAmount: taxable,
        taxAmount: tax,
        netAmount: net,
        grossAmount: entry.gross,
        itemDiscountAmount: entry.itemDiscount,
        orderDiscountAmount: orderDiscount
      };
    });

    const subTotal = this.round2(computedLines.reduce((acc, l) => acc + l.grossAmount, 0));
    const discountTotal = this.round2(computedLines.reduce((acc, l) => acc + l.discountAmount, 0));
    const orderDiscountTotal = this.round2(computedLines.reduce((acc, l) => acc + l.orderDiscountAmount, 0));
    const taxTotal = this.round2(computedLines.reduce((acc, l) => acc + l.taxAmount, 0));
    const grandTotal = this.round2(computedLines.reduce((acc, l) => acc + l.netAmount, 0));

    return { computedLines, subTotal, discountTotal, orderDiscountTotal, taxTotal, grandTotal };
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
      data: { [field]: { increment: 1 } },
      select: {
        code: true,
        invoiceSeq: true,
        receiptSeq: true,
        returnSeq: true,
        customerSeq: true,
        invoicePrefix: true,
        receiptPrefix: true,
        returnPrefix: true
      }
    });

    const prefix =
      type === 'invoice'
        ? branch.invoicePrefix
        : type === 'receipt'
          ? branch.receiptPrefix
          : type === 'return'
            ? branch.returnPrefix
            : 'CUST';

    return {
      branchCode: branch.code,
      seq: (branch as any)[field] as number,
      prefix
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
    const user = await this.prisma.user.findUnique({
      where: { username },
      include: {
        branchAccesses: {
          include: { branch: { select: this.branchSummarySelect } },
          orderBy: { createdAt: 'asc' }
        }
      }
    });
    if (!user || user.password !== password) {
      throw new BadRequestException('Invalid credentials');
    }
    if (!user.isActive) {
      throw new BadRequestException('Account is inactive');
    }

    const openRegister = await this.prisma.registerSession.findFirst({
      where: { userId: user.id, closedAt: null },
      select: { id: true, branchId: true }
    });

    const token = this.buildToken({
      userId: user.id,
      role: user.role,
      branchId: openRegister?.branchId,
      registerId: openRegister?.id
    });
    return {
      token,
      userId: user.id,
      username: user.username,
      role: user.role,
      branchId: openRegister?.branchId ?? null,
      registerId: openRegister?.id ?? null,
      branches: user.branchAccesses.map((access) => access.branch)
    };
  }

  async me(session: SessionUser) {
    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
      include: {
        branchAccesses: {
          include: { branch: { select: this.branchSummarySelect } },
          orderBy: { createdAt: 'asc' }
        }
      }
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return {
      ...session,
      username: user.username,
      branches: user.branchAccesses.map((access) => access.branch)
    };
  }

  async listAccessibleBranches(session: SessionUser) {
    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
      include: {
        branchAccesses: {
          include: { branch: { select: this.branchSummarySelect } },
          orderBy: { createdAt: 'asc' }
        }
      }
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user.branchAccesses.map((access) => access.branch);
  }

  async openRegister(session: SessionUser, branchId: string, openingBalance: number) {
    if (!Number.isFinite(openingBalance) || openingBalance < 0) {
      throw new BadRequestException('Opening balance must be 0 or more');
    }
    await this.ensureBranchExists(branchId);
    await this.ensureUserHasBranchAccess(session.userId, branchId);

    const openRegister = await this.prisma.registerSession.findFirst({
      where: { branchId, closedAt: null },
      select: { id: true }
    });
    if (openRegister) {
      throw new BadRequestException('This branch already has an open register. Close it before opening a new one.');
    }

    const register = await this.prisma.registerSession.create({
      data: {
        userId: session.userId,
        branchId,
        openingBalance
      }
    });

    return {
      token: this.buildToken({ userId: session.userId, role: session.role, branchId, registerId: register.id }),
      register: {
        id: register.id,
        branchId: register.branchId,
        openingBalance: this.toNumber(register.openingBalance),
        closingBalance: register.closingBalance ? this.toNumber(register.closingBalance) : null,
        openedAt: register.openedAt,
        closedAt: register.closedAt
      }
    };
  }

  async getCurrentRegister(session: SessionUser) {
    if (!session.registerId) {
      return null;
    }
    const register = await this.prisma.registerSession.findFirst({
      where: { id: session.registerId, userId: session.userId, closedAt: null },
      select: {
        id: true,
        branchId: true,
        openingBalance: true,
        closingBalance: true,
        openedAt: true,
        closedAt: true
      }
    });
    if (!register) {
      return null;
    }
    return {
      id: register.id,
      branchId: register.branchId,
      openingBalance: this.toNumber(register.openingBalance),
      closingBalance: register.closingBalance ? this.toNumber(register.closingBalance) : null,
      openedAt: register.openedAt,
      closedAt: register.closedAt
    };
  }

  async getRegisterSummaries(session: SessionUser) {
    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
      include: {
        branchAccesses: {
          include: { branch: { select: this.branchSummarySelect } },
          orderBy: { createdAt: 'asc' }
        }
      }
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const branchIds = user.branchAccesses.map((access) => access.branch.id);
    if (branchIds.length === 0) {
      return [];
    }

    const openRegisters = await this.prisma.registerSession.findMany({
      where: { branchId: { in: branchIds }, closedAt: null },
      select: {
        id: true,
        branchId: true,
        openingBalance: true,
        closingBalance: true,
        openedAt: true,
        closedAt: true
      }
    });

    const lastClosedRegisters = await this.prisma.registerSession.findMany({
      where: { branchId: { in: branchIds }, closedAt: { not: null } },
      orderBy: { closedAt: 'desc' },
      distinct: ['branchId'],
      select: {
        id: true,
        branchId: true,
        openingBalance: true,
        closingBalance: true,
        openedAt: true,
        closedAt: true
      }
    });

    const openByBranch = new Map(openRegisters.map((register) => [register.branchId, register]));
    const lastClosedByBranch = new Map(
      lastClosedRegisters.map((register) => [register.branchId, register])
    );

    const toDto = (
      register:
        | {
            id: string;
            branchId: string;
            openingBalance: Prisma.Decimal;
            closingBalance: Prisma.Decimal | null;
            openedAt: Date;
            closedAt: Date | null;
          }
        | undefined
    ) => {
      if (!register) return null;
      return {
        id: register.id,
        branchId: register.branchId,
        openingBalance: this.toNumber(register.openingBalance),
        closingBalance: register.closingBalance ? this.toNumber(register.closingBalance) : null,
        openedAt: register.openedAt,
        closedAt: register.closedAt
      };
    };

    return branchIds.map((branchId) => ({
      branchId,
      current: toDto(openByBranch.get(branchId)),
      lastClosed: toDto(lastClosedByBranch.get(branchId))
    }));
  }

  async closeRegister(session: SessionUser, closingBalance: number) {
    if (!Number.isFinite(closingBalance) || closingBalance < 0) {
      throw new BadRequestException('Closing balance must be 0 or more');
    }
    const registerId = this.requireSessionRegisterId(session);
    const branchId = this.requireSessionBranchId(session);
    const register = await this.prisma.registerSession.findFirst({
      where: { id: registerId, userId: session.userId, branchId, closedAt: null },
      select: { id: true, branchId: true, openingBalance: true, openedAt: true }
    });
    if (!register) {
      throw new NotFoundException('Open register not found');
    }

    const updated = await this.prisma.registerSession.update({
      where: { id: register.id },
      data: {
        closingBalance,
        closedAt: new Date()
      },
      select: {
        id: true,
        branchId: true,
        openingBalance: true,
        closingBalance: true,
        openedAt: true,
        closedAt: true
      }
    });

    return {
      token: this.buildToken({ userId: session.userId, role: session.role }),
      register: {
        id: updated.id,
        branchId: updated.branchId,
        openingBalance: this.toNumber(updated.openingBalance),
        closingBalance: updated.closingBalance ? this.toNumber(updated.closingBalance) : null,
        openedAt: updated.openedAt,
        closedAt: updated.closedAt
      }
    };
  }

  async listCustomers(branchId: string) {
    const where = branchId
      ? { OR: [{ isWalkIn: false }, { isWalkIn: true, branchId }] }
      : { isWalkIn: false };
    return this.prisma.customer.findMany({ where, orderBy: { createdAt: 'desc' } });
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
    input: {
      branchId: string;
      customerId: string;
      lines: SaleLineInput[];
      orderDiscountAmount?: number;
    }
  ) {
    const sessionBranchId = this.requireSessionBranchId(session);
    if (sessionBranchId !== input.branchId) {
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
      const invoiceNo = `${seq.prefix}-${seq.branchCode}-${String(seq.seq).padStart(6, '0')}`;

      const {
        computedLines,
        subTotal,
        discountTotal,
        orderDiscountTotal,
        taxTotal,
        grandTotal
      } = this.calculateSaleTotals(normalizedLines, input.orderDiscountAmount ?? 0);

      const invoice = await tx.saleInvoice.create({
        data: {
          branchId: input.branchId,
          invoiceNo,
          customerId: input.customerId,
          status: InvoiceStatus.DRAFT,
          subTotal,
          discountTotal,
          orderDiscountAmount: orderDiscountTotal,
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
    const sessionBranchId = this.requireSessionBranchId(session);
    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.saleInvoice.findUnique({
        where: { id: invoiceId },
        include: { lines: true, payments: true, customer: true }
      });

      if (!invoice) throw new NotFoundException('Invoice not found');
      if (invoice.branchId !== sessionBranchId) throw new BadRequestException('Branch mismatch');

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
    const invoice = await this.prisma.saleInvoice.findUnique({
      where: { id },
      include: {
        lines: {
          include: {
            returnLines: {
              select: {
                id: true,
                returnInvoiceId: true,
                qty: true,
                amount: true
              }
            }
          }
        },
        payments: true
      }
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return this.withCreatedByName(invoice);
  }

  async createReturn(
    session: SessionUser,
    saleInvoiceId: string,
    input: { lines: Array<{ saleLineId: string; qty: number }>; refundMode: 'CASH' | 'WALLET' }
  ) {
    const sessionBranchId = this.requireSessionBranchId(session);
    return this.prisma.$transaction(async (tx) => {
      if (input.refundMode !== PaymentMode.CASH && input.refundMode !== PaymentMode.WALLET) {
        throw new BadRequestException('Return refund mode must be CASH or WALLET');
      }

      const invoice = await tx.saleInvoice.findUnique({
        where: { id: saleInvoiceId },
        include: { lines: { include: { returnLines: true } } }
      });

      if (!invoice) throw new NotFoundException('Invoice not found');
      if (invoice.branchId !== sessionBranchId) throw new BadRequestException('Branch mismatch');

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
      const returnNo = `${seq.prefix}-${seq.branchCode}-${String(seq.seq).padStart(6, '0')}`;

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

  async listReturns(branchId: string) {
    const returns = await this.prisma.returnInvoice.findMany({
      where: { saleInvoice: { branchId } },
      include: {
        saleInvoice: {
          select: {
            invoiceNo: true,
            customer: {
              select: { name: true }
            }
          }
        },
        lines: { select: { id: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    return returns.map((row) => ({
      id: row.id,
      saleInvoiceId: row.saleInvoiceId,
      returnNo: row.returnNo,
      totalAmount: row.totalAmount,
      refundMode: row.refundMode,
      createdAt: row.createdAt,
      saleInvoiceNo: row.saleInvoice.invoiceNo,
      customerName: row.saleInvoice.customer.name,
      lineCount: row.lines.length
    }));
  }

  async getReturnById(session: SessionUser, id: string) {
    const returnInvoice = await this.prisma.returnInvoice.findUnique({
      where: { id },
      include: {
        saleInvoice: {
          include: {
            customer: { select: { name: true } }
          }
        },
        lines: {
          include: {
            saleLine: {
              include: {
                item: { select: { id: true, name: true } }
              }
            }
          }
        }
      }
    });

    if (!returnInvoice) throw new NotFoundException('Return invoice not found');
    const sessionBranchId = this.requireSessionBranchId(session);
    if (returnInvoice.saleInvoice.branchId !== sessionBranchId) throw new BadRequestException('Branch mismatch');

    return {
      id: returnInvoice.id,
      saleInvoiceId: returnInvoice.saleInvoiceId,
      returnNo: returnInvoice.returnNo,
      totalAmount: returnInvoice.totalAmount,
      refundMode: returnInvoice.refundMode,
      createdAt: returnInvoice.createdAt,
      saleInvoiceNo: returnInvoice.saleInvoice.invoiceNo,
      customerName: returnInvoice.saleInvoice.customer.name,
      lines: returnInvoice.lines.map((line) => ({
        id: line.id,
        saleLineId: line.saleLineId,
        itemId: line.saleLine.item.id,
        itemName: line.saleLine.item.name,
        qty: line.qty,
        amount: line.amount
      }))
    };
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
    if (session.branchId && session.branchId !== branchId) {
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
