import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StockTransferStatus, StockTxnType } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { SessionUser } from '../common/types';
import { AccessService } from '../common/access.service';
import { branchSummarySelect } from '../common/selects';
import { toNumber, round3 } from '../common/numbers';
import { assertQtyRespectsLeastCount } from '../common/quantities';
import { BranchesService } from '../branches/branches.service';
import { SettingsService } from '../settings/settings.service';
import { SequenceService } from '../sequences/sequences.service';
import { StockService } from '../stock/stock.service';
import { isOffline, offlineLimitError } from '../common/mode';

export type CreateTransferInput = {
  fromBranchId: string;
  toBranchId: string;
  note?: string;
  lines: Array<{ itemId: string; qty: number }>;
};

export const transferInclude = {
  fromBranch: { select: branchSummarySelect },
  toBranch: { select: branchSummarySelect },
  lines: { include: { item: { select: { code: true, name: true, uom: true } } } }
} satisfies Prisma.StockTransferInclude;

@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly branches: BranchesService,
    private readonly sequences: SequenceService,
    private readonly stock: StockService,
    private readonly access: AccessService
  ) {}

  /** Sends stock to another branch: it leaves the source now and is in transit until received. */
  async createTransfer(session: SessionUser, input: CreateTransferInput) {
    if (isOffline()) {
      throw offlineLimitError('transfer stock between branches');
    }
    if (input.fromBranchId === input.toBranchId) {
      throw new BadRequestException('Choose a different branch to send to');
    }
    // Sent by someone who manages the sending branch; any branch of the business can receive.
    await this.settings.ensureBranchExists(input.fromBranchId);
    await this.access.requireBranch(session, input.fromBranchId);
    await this.access.requirePermission(session, 'SEND_TRANSFERS');
    await this.settings.ensureBranchExists(input.toBranchId);

    return this.prisma.$transaction(async (tx) => {
      const items = await tx.item.findMany({
        where: { id: { in: input.lines.map((line) => line.itemId) } },
        select: { id: true, name: true, leastCount: true, costPrice: true }
      });
      const itemsById = new Map(items.map((item) => [item.id, item]));
      const lines = input.lines.map((line) => {
        const item = itemsById.get(line.itemId);
        if (!item) throw new NotFoundException(`Item not found: ${line.itemId}`);
        assertQtyRespectsLeastCount(line.qty, toNumber(item.leastCount), item.name);
        return { item, qty: round3(line.qty) };
      });

      await this.stock.lockItemStock(tx, input.fromBranchId, lines.map((line) => line.item.id));
      for (const line of lines) {
        const onHand = await this.stock.getOnHandForItem(input.fromBranchId, line.item.id, tx);
        if (onHand + 1e-9 < line.qty) {
          throw new BadRequestException(`Insufficient stock for ${line.item.name}: ${round3(onHand)} on hand, ${line.qty} to send`);
        }
      }

      const user = await tx.user.findUnique({ where: { id: session.userId }, select: { username: true } });
      if (!user) throw new NotFoundException('User not found');
      const seq = await this.sequences.nextSequence(input.fromBranchId, 'transfer', tx);
      const transferNo = `${seq.prefix}-${seq.branchCode}-${String(seq.seq).padStart(6, '0')}`;

      const transfer = await tx.stockTransfer.create({
        data: {
          transferNo,
          fromBranchId: input.fromBranchId,
          toBranchId: input.toBranchId,
          note: input.note?.trim() || null,
          createdBy: session.userId,
          createdByName: user.username,
          lines: { create: lines.map((line) => ({ itemId: line.item.id, qty: line.qty, unitCost: line.item.costPrice })) }
        },
        include: transferInclude
      });

      await this.stock.recordStock(
        tx,
        transfer.lines.map((line) => ({
          branchId: input.fromBranchId,
          itemId: line.itemId,
          txnType: StockTxnType.TRANSFER_OUT,
          qtyIn: 0,
          qtyOut: toNumber(line.qty),
          costPrice: line.unitCost,
          reason: `${transferNo} to ${transfer.toBranch.name}`,
          referenceType: 'TRANSFER',
          referenceId: transfer.id
        }))
      );
      return transfer;
    });
  }

  /** Takes a transfer in at the receiving branch. */
  receiveTransfer(session: SessionUser, transferId: string) {
    return this.closeTransfer(session, transferId, StockTransferStatus.RECEIVED);
  }

  /** Calls a transfer back while it is in transit; the stock returns to the sending branch. */
  cancelTransfer(session: SessionUser, transferId: string) {
    return this.closeTransfer(session, transferId, StockTransferStatus.CANCELLED);
  }

  private async closeTransfer(session: SessionUser, transferId: string, status: 'RECEIVED' | 'CANCELLED') {
    const transfer = await this.prisma.stockTransfer.findUnique({
      where: { id: transferId },
      select: { fromBranchId: true, toBranchId: true }
    });
    if (!transfer) throw new NotFoundException('Transfer not found');
    const received = status === StockTransferStatus.RECEIVED;
    if (received) {
      // Whoever is at the receiving branch takes the goods in: anyone with access to it.
      await this.branches.ensureUserHasBranchAccess(session.userId, transfer.toBranchId);
    } else {
      // Called back by someone who may send from the sending branch.
      await this.access.requireBranch(session, transfer.fromBranchId);
      await this.access.requirePermission(session, 'SEND_TRANSFERS');
    }

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: session.userId }, select: { username: true } });
      if (!user) throw new NotFoundException('User not found');
      // Moves out of IN_TRANSIT once, so receiving and cancelling at the same moment can't both happen.
      const { count } = await tx.stockTransfer.updateMany({
        where: { id: transferId, status: StockTransferStatus.IN_TRANSIT },
        data: { status, closedBy: session.userId, closedByName: user.username, closedAt: new Date() }
      });
      if (count === 0) {
        throw new BadRequestException('This transfer has already been received or cancelled');
      }

      const closed = await tx.stockTransfer.findUniqueOrThrow({ where: { id: transferId }, include: transferInclude });
      await this.stock.recordStock(
        tx,
        closed.lines.map((line) => ({
          branchId: received ? closed.toBranchId : closed.fromBranchId,
          itemId: line.itemId,
          txnType: received ? StockTxnType.TRANSFER_IN : StockTxnType.TRANSFER_CANCEL,
          qtyIn: toNumber(line.qty),
          qtyOut: 0,
          costPrice: line.unitCost,
          reason: received ? `${closed.transferNo} from ${closed.fromBranch.name}` : `${closed.transferNo} cancelled`,
          referenceType: 'TRANSFER',
          referenceId: closed.id
        }))
      );
      return closed;
    });
  }

  /** Transfers sent from or to a branch, newest first (the latest 200). */
  async listTransfers(session: SessionUser, branchId: string) {
    await this.settings.ensureBranchExists(branchId);
    await this.branches.ensureUserHasBranchAccess(session.userId, branchId);
    return this.prisma.stockTransfer.findMany({
      where: { OR: [{ fromBranchId: branchId }, { toBranchId: branchId }] },
      include: transferInclude,
      orderBy: { createdAt: 'desc' },
      take: 200
    });
  }
}
