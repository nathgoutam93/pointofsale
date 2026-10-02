import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

@Injectable()
export class SequenceService {
  constructor(
    private readonly prisma: PrismaService
  ) {}

  async nextSequence(branchId: string, type: 'invoice' | 'receipt' | 'return' | 'customer', tx: Prisma.TransactionClient) {
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
}
