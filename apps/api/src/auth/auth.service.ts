import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma.service';
import { hashPassword, isPasswordHash, validateNewPassword, verifyPassword } from './password';
import { signToken } from './token';
import type { SessionUser } from '../common/types';
import { toNumber } from '../common/numbers';
import { branchSummarySelect } from '../common/selects';
import { DEFAULT_COUNTER_NAME } from '../common/counters';
import { CustomersService } from '../customers/customers.service';
import { isOffline } from '../common/mode';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersService
  ) {}

  async login(username: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { username },
      include: {
        branchAccesses: {
          include: { branch: { select: branchSummarySelect } },
          orderBy: { createdAt: 'asc' }
        }
      }
    });
    if (!user || typeof password !== 'string' || !(await verifyPassword(password, user.password))) {
      throw new BadRequestException('Invalid credentials');
    }
    if (!user.isActive) {
      throw new BadRequestException('Account is inactive');
    }

    const openRegister = await this.prisma.registerSession.findFirst({
      where: { userId: user.id, closedAt: null },
      orderBy: { openedAt: 'desc' },
      select: { id: true, branchId: true, counter: { select: { id: true, name: true } } }
    });

    const token = signToken({
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
      counterId: openRegister?.counter.id ?? null,
      counterName: openRegister?.counter.name ?? null,
      branches: user.branchAccesses.map((access) => access.branch)
    };
  }

  async me(session: SessionUser) {
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
    return {
      ...session,
      username: user.username,
      branches: user.branchAccesses.map((access) => access.branch)
    };
  }

  /** Creates the first admin only on an empty database; never a fixed default password. */
  private async seedFirstAdmin(branchId: string) {
    const userCount = await this.prisma.user.count();
    if (userCount > 0) {
      return;
    }

    const configured = process.env.SEED_ADMIN_PASSWORD;
    if (configured) {
      const passwordError = validateNewPassword(configured);
      if (passwordError) {
        throw new Error(`SEED_ADMIN_PASSWORD: ${passwordError}`);
      }
    }
    const password = configured || randomBytes(12).toString('base64url');
    await this.prisma.user.create({
      data: { username: 'admin', password: await hashPassword(password), role: UserRole.ADMIN, branchId }
    });
    if (!configured) {
      this.logger.warn(`Created first admin account. Username: admin  Password: ${password}  (shown once; change it after signing in)`);
    }
  }

  /** Hashes any passwords still stored as plain text, and flags accounts still using "password". */
  private async hashPlaintextPasswords() {
    const users = await this.prisma.user.findMany({ select: { id: true, username: true, password: true, isActive: true } });
    for (const user of users) {
      const plaintext = isPasswordHash(user.password) ? null : user.password;
      if (plaintext !== null) {
        await this.prisma.user.update({ where: { id: user.id }, data: { password: await hashPassword(plaintext) } });
      }
      const usesDefault =
        plaintext !== null ? plaintext === 'password' : await verifyPassword('password', user.password);
      if (usesDefault && user.isActive) {
        this.logger.warn(`User "${user.username}" still uses the default password "password". Reset it in Branch Settings.`);
      }
    }
  }

  /**
   * Walk-in customers no longer have a usable wallet. Any balance left from before (wallet
   * refunds paid into the shared walk-in wallet) is frozen as a record; list it so an admin
   * can settle those refunds by hand.
   */
  private async warnAboutWalkInWalletBalances() {
    const wallets = await this.prisma.walletAccount.findMany({
      where: { customer: { isWalkIn: true }, NOT: { balance: 0 } },
      select: { balance: true, branch: { select: { code: true } } }
    });
    for (const wallet of wallets) {
      this.logger.warn(
        `Branch ${wallet.branch.code}: the walk-in customer's wallet holds ${toNumber(wallet.balance).toFixed(2)} from before walk-in wallets were turned off. It can't be spent; settle these refunds by hand.`
      );
    }
  }

  async onModuleInitSeed() {
    if (isOffline()) {
      // An offline install's business, branch and admin come from first-run setup (POST /setup).
      if ((await this.prisma.user.count()) > 0) {
        await this.hashPlaintextPasswords();
        await this.warnAboutWalkInWalletBalances();
      }
      return;
    }

    const branch =
      (await this.prisma.branch.findUnique({ where: { code: 'MAI' } })) ??
      (await this.prisma.$transaction(async (tx) => {
        const created = await tx.branch.create({
          data: { name: 'Main Branch', code: 'MAI' }
        });
        await tx.counter.create({ data: { branchId: created.id, number: 1, name: DEFAULT_COUNTER_NAME } });
        return created;
      }));

    await this.seedFirstAdmin(branch.id);
    await this.hashPlaintextPasswords();
    await this.warnAboutWalkInWalletBalances();

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

    await this.customers.ensureWalkInCustomer(branch.id);
  }
}
