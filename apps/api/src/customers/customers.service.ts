import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CustomerScope, Prisma, WalletTxnType } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { toNumber } from '../common/numbers';
import { SettingsService } from '../settings/settings.service';
import { SequenceService } from '../sequences/sequences.service';
import { isFallback } from '../common/mode';
import { randomBytes } from 'crypto';

/** A registered buyer's details (see Customer in schema.prisma); null clears one. */
export type BuyerFields = { gstin?: string | null; address?: string | null; email?: string | null };
/** A customer's credit (see Customer in schema.prisma); null clears one. Only admins set these. */
export type CreditFields = { creditLimit?: number | null; paymentTermsDays?: number | null };

/** A customer as the API answers it: the credit limit as a number. */
export function customerView<T extends { creditLimit: Prisma.Decimal | null }>(customer: T) {
  return { ...customer, creditLimit: customer.creditLimit === null ? null : toNumber(customer.creditLimit) };
}

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly sequences: SequenceService
  ) {}

  async ensureWalkInCustomer(branchId: string) {
    const existing = await this.prisma.customer.findFirst({ where: { branchId, isWalkIn: true } });
    if (existing) return existing;

    const sequence = await this.prisma.$transaction(async (tx) => {
      const seq = await this.sequences.nextSequence(branchId, 'customer', tx);
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

  /**
   * Whether a branch may use a customer: each branch's walk-in customer is its own; other
   * customers are shared by every branch, or only their home branch, per the business setting.
   */
  customerUsableAt(customer: { branchId: string; isWalkIn: boolean }, branchId: string, scope: CustomerScope) {
    if (customer.isWalkIn || scope === CustomerScope.BRANCH) return customer.branchId === branchId;
    return true;
  }

  /**
   * Every anonymous shopper at a branch is the same walk-in customer record, so a walk-in
   * "wallet" would be shared by strangers: a refund paid into it could be spent by the next
   * shopper. Walk-in customers therefore have no wallet: no wallet payments, refunds or top-ups.
   */
  assertHasWallet(customer: { isWalkIn: boolean }) {
    if (customer.isWalkIn) {
      throw new BadRequestException("Walk-in customers don't have a wallet. Use cash, or pick a registered customer.");
    }
  }

  /** A phone number identifies one customer: across all branches when shared, within the branch otherwise. */
  private async assertPhoneFree(
    phone: string | null | undefined,
    branchId: string,
    scope: CustomerScope,
    exceptCustomerId?: string,
    tx?: Prisma.TransactionClient
  ) {
    if (!phone) return;
    const client = tx ?? this.prisma;
    const existing = await client.customer.findFirst({
      where: {
        phone,
        isWalkIn: false,
        ...(scope === CustomerScope.BRANCH ? { branchId } : {}),
        ...(exceptCustomerId ? { id: { not: exceptCustomerId } } : {})
      },
      select: { name: true, code: true }
    });
    if (existing) {
      throw new BadRequestException(`Phone ${phone} already belongs to ${existing.name} (${existing.code})`);
    }
  }

  async listCustomers(branchId: string) {
    const scope = await this.settings.getCustomerScope();
    const where: Prisma.CustomerWhereInput =
      scope === CustomerScope.SHARED
        ? { OR: [{ isWalkIn: false }, { isWalkIn: true, branchId }] }
        : { branchId };
    return (await this.prisma.customer.findMany({ where, orderBy: { createdAt: 'desc' } })).map(customerView);
  }

  async createCustomer(branchId: string, name: string, phone?: string, buyer: BuyerFields & CreditFields = {}) {
    const normalizedPhone = phone?.trim() || null;
    return this.prisma.$transaction(async (tx) => {
      const scope = await this.settings.getCustomerScope(tx);
      await this.assertPhoneFree(normalizedPhone, branchId, scope, undefined, tx);
      // Working offline (fallback counter): a code of its own until the server gives it one
      // (see OFFLINE_CUSTOMER_CODE), since the server may be numbering customers meanwhile.
      const code = isFallback()
        ? `OFF-${randomBytes(4).toString('hex').toUpperCase()}`
        : await this.sequences.nextSequence(branchId, 'customer', tx).then((seq) => `CUST-${seq.branchCode}-${String(seq.seq).padStart(6, '0')}`);
      const customer = await tx.customer.create({
        data: {
          branchId,
          code,
          name,
          phone: normalizedPhone,
          gstin: buyer.gstin ?? null,
          address: buyer.address ?? null,
          email: buyer.email ?? null,
          creditLimit: buyer.creditLimit ?? null,
          paymentTermsDays: buyer.paymentTermsDays ?? null
        }
      });

      await tx.walletAccount.create({
        data: {
          customerId: customer.id,
          branchId,
          balance: 0
        }
      });

      return customerView(customer);
    });
  }

  async updateCustomer(branchId: string, customerId: string, input: { name?: string; phone?: string | null } & BuyerFields & CreditFields) {
    const scope = await this.settings.getCustomerScope();
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, branchId: true, isWalkIn: true }
    });
    if (!customer || !this.customerUsableAt(customer, branchId, scope)) {
      throw new NotFoundException('Customer not found');
    }
    if (customer.isWalkIn) {
      throw new BadRequestException('Walk-in customer cannot be edited');
    }

    const updates: { name?: string; phone?: string | null } & BuyerFields & CreditFields = {};
    // Validated (and empty values made null) by the contract.
    if (input.gstin !== undefined) updates.gstin = input.gstin;
    if (input.address !== undefined) updates.address = input.address;
    if (input.email !== undefined) updates.email = input.email;
    if (input.creditLimit !== undefined) updates.creditLimit = input.creditLimit;
    if (input.paymentTermsDays !== undefined) updates.paymentTermsDays = input.paymentTermsDays;
    if (input.name !== undefined) {
      updates.name = input.name.trim();
    }
    if (input.phone !== undefined) {
      const nextPhone = input.phone?.trim() ?? '';
      updates.phone = nextPhone.length ? nextPhone : null;
    }
    if (Object.keys(updates).length === 0) {
      throw new BadRequestException('No customer fields provided to update');
    }
    if (updates.name !== undefined && updates.name.length === 0) {
      throw new BadRequestException('Customer name is required');
    }
    await this.assertPhoneFree(updates.phone, customer.branchId, scope, customer.id);

    return customerView(await this.prisma.customer.update({
      where: { id: customerId },
      data: updates
    }));
  }

  async getWalkIn(branchId: string) {
    return customerView(await this.ensureWalkInCustomer(branchId));
  }

  /** The customer's wallet, if this branch may use the customer (see customerUsableAt). */
  private async findUsableWallet(branchId: string, customerId: string, tx?: Prisma.TransactionClient) {
    const scope = await this.settings.getCustomerScope(tx);
    const wallet = await (tx ?? this.prisma).walletAccount.findUnique({
      where: { customerId },
      include: { customer: { select: { branchId: true, isWalkIn: true } } }
    });
    if (!wallet || !this.customerUsableAt(wallet.customer, branchId, scope)) {
      throw new NotFoundException('Wallet not found');
    }
    this.assertHasWallet(wallet.customer);
    return wallet;
  }

  async getWallet(branchId: string, customerId: string) {
    const wallet = await this.findUsableWallet(branchId, customerId);
    return { customerId, branchId: wallet.branchId, balance: toNumber(wallet.balance) };
  }

  async topupWallet(branchId: string, customerId: string, amount: number, reference?: string) {
    return this.prisma.$transaction(async (tx) => {
      const wallet = await this.findUsableWallet(branchId, customerId, tx);

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
}
