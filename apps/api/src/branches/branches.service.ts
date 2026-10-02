import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { SessionUser } from '../common/types';
import { branchSummarySelect } from '../common/selects';
import { CustomersService } from '../customers/customers.service';
import { SequenceService } from '../sequences/sequences.service';

@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersService,
    private readonly sequences: SequenceService
  ) {}

  async ensureUserHasBranchAccess(userId: string, branchId: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    const access = await client.userBranchAccess.findUnique({
      where: { userId_branchId: { userId, branchId } },
      select: { id: true }
    });
    if (!access) {
      throw new BadRequestException('You do not have access to this branch');
    }
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
          data: { name, code, ...(await this.sequences.freeDocumentSeries(tx, code)) },
          select: branchSummarySelect
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

      await this.customers.ensureWalkInCustomer(branch.id);
      return branch;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('Branch code already exists');
      }
      throw error;
    }
  }

  async listAccessibleBranches(session: SessionUser) {
    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
      include: {
        branchAccesses: {
          include: { branch: { select: branchSummarySelect } },
          orderBy: { createdAt: 'asc' }
        }
      }
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user.branchAccesses.map((access) => access.branch);
  }
}
