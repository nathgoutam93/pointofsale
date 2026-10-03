import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { hashPassword, isPasswordHash, verifyPassword } from './password';
import { signToken } from './token';
import type { SessionUser } from '../common/types';
import { toNumber } from '../common/numbers';
import { branchSummarySelect } from '../common/selects';
import { isOffline } from '../common/mode';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly prisma: PrismaService) {}

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

  /**
   * At startup. Offline: tidies data left by older versions. Online: nothing; each business
   * gets its admin when it is created (sign-up), and the server has no business of its own.
   */
  async onModuleInitSeed() {
    if (!isOffline()) return;
    if ((await this.prisma.user.count()) > 0) await this.upgradeLegacyData();
  }

  /** Hashes passwords left in plain text by older versions and flags old walk-in wallets. */
  async upgradeLegacyData() {
    await this.hashPlaintextPasswords();
    await this.warnAboutWalkInWalletBalances();
  }
}
