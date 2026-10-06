import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { InvoiceStatus, PaymentMode, Prisma, WalletTxnType } from '@prisma/client';
import { invoiceDue } from '@pos/contracts';
import { isFallback } from '../common/mode';
import type { PaymentInput, SessionUser } from '../common/types';
import { toNumber, round2 } from '../common/numbers';
import { requireSessionBranchId } from '../common/session';
import { saleInvoiceInclude } from '../common/selects';
import { SequenceService } from '../sequences/sequences.service';
import { CustomersService, walletTxnAuthor } from '../customers/customers.service';
import { RegistersService } from '../registers/registers.service';

/**
 * Taking payment for a sale: the payments, the wallet debited or credited with the change, the
 * invoice's paid total and status, and a receipt. Runs inside SalesService's transactions.
 */
@Injectable()
export class SaleSettlementService {
  constructor(
    private readonly sequences: SequenceService,
    private readonly customers: CustomersService,
    private readonly registers: RegistersService
  ) {}

  /** Records payments against an unpaid invoice, inside the caller's transaction. */
  async settleSaleInTx(tx: Prisma.TransactionClient, session: SessionUser, invoiceId: string, payments: PaymentInput[], idempotencyKey?: string) {
    const sessionBranchId = requireSessionBranchId(session);
    if (payments.length === 0 || payments.some((p) => !Number.isFinite(p.amount) || p.amount <= 0)) {
      throw new BadRequestException('Each payment amount must be greater than zero');
    }
    if (payments.some((p) => p.tendered !== undefined && (p.mode !== PaymentMode.CASH || !(round2(p.tendered) >= round2(p.amount))))) {
      throw new BadRequestException('Cash tendered is for cash payments, and at least the amount paid');
    }
    const requestFingerprint = createHash('sha256').update(JSON.stringify(payments.map((p) => ({
      mode: p.mode, amount: p.amount, tendered: p.tendered ?? null, reference: p.reference ?? null
    })))).digest('hex');
    // Serialize use of a key even across different invoices. The unique index is the durable
    // safeguard; the transaction lock lets a concurrent retry read the winning receipt.
    if (idempotencyKey) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`settlement:${idempotencyKey}`}, 0))`;
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
    if (invoice.branchId !== sessionBranchId) throw new ForbiddenException('Branch mismatch');
    if (idempotencyKey) {
      const receipt = await tx.receipt.findUnique({ where: { idempotencyKey } });
      if (receipt) {
        if (receipt.invoiceId !== invoiceId || receipt.settlementUserId !== session.userId || receipt.requestFingerprint !== requestFingerprint) {
          throw new BadRequestException('This payment key was already used for a different request');
        }
        // A replay is valid even if the invoice was paid or returned later.
        return { invoice, receipt };
      }
    }
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
        amount: payTotal,
        ...(idempotencyKey ? { idempotencyKey, requestFingerprint, settlementUserId: session.userId } : {})
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
}
