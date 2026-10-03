import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { randomInt } from 'crypto';
import { hashPassword, newPasswordFields, verifyPassword } from '../auth/password';
import { signedBeforePasswordChange, verifyAccountToken } from '../auth/token';
import { Mailer } from '../mail/mailer';
import { PrismaService } from '../prisma.service';
import { TenancyService } from '../tenancy/tenancy.service';

/** How long an emailed reset code works, and how many wrong tries it allows. */
const RESET_CODE_MINUTES = 15;
const RESET_CODE_TRIES = 5;

/** Business owners' accounts on the hosted server (email and password, in the control schema). */
@Injectable()
export class AccountsService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly prisma: PrismaService,
    private readonly mailer: Mailer
  ) {}

  /** The account for `email`, created on first use; an existing one needs its password. */
  async findOrCreate(email: string, password: string) {
    const control = this.tenancy.control;
    const existing = await control.account.findUnique({ where: { email } });
    if (existing) {
      if (!(await verifyPassword(password, existing.passwordHash))) {
        throw new BadRequestException('This email already has an account; enter its password');
      }
      return existing;
    }
    return control.account.create({ data: { email, passwordHash: await hashPassword(password) } });
  }

  async login(email: string, password: string) {
    const account = await this.tenancy.control.account.findUnique({ where: { email } });
    if (!account || !(await verifyPassword(password, account.passwordHash))) {
      throw new BadRequestException('Invalid email or password');
    }
    return account;
  }

  /** The account behind an owner token, or 401. A password reset ends the tokens signed before it. */
  async accountIdFrom(token: string | null) {
    const verified = token ? verifyAccountToken(token) : null;
    if (!verified) throw new UnauthorizedException('Sign in with your owner account');
    const account = await this.tenancy.control.account.findUnique({
      where: { id: verified.accountId },
      select: { passwordChangedAt: true }
    });
    if (!account || signedBeforePasswordChange(verified.issuedAt, account.passwordChangedAt)) {
      throw new UnauthorizedException('Sign in with your owner account again');
    }
    return verified.accountId;
  }

  async businessesOf(accountId: string) {
    const memberships = await this.tenancy.control.membership.findMany({
      where: { accountId },
      orderBy: { createdAt: 'asc' },
      select: { business: { select: { id: true, code: true, name: true, status: true } } }
    });
    return memberships.map((membership) => membership.business);
  }

  /**
   * An owner gives a staff user of their business a new password (an admin who forgot theirs).
   * Their sessions end. An admin is reactivated; a cashier chooses their own at next sign-in.
   */
  async resetStaffPassword(accountId: string, input: { businessId: string; username: string; newPassword: string }) {
    const membership = await this.tenancy.control.membership.findUnique({
      where: { accountId_businessId: { accountId, businessId: input.businessId } },
      select: { role: true }
    });
    if (!membership) throw new ForbiddenException("That business isn't one of yours");
    await this.tenancy.enterById(input.businessId).catch(() => {
      throw new BadRequestException("This business isn't active");
    });
    const user = await this.prisma.user.findUnique({ where: { username: input.username }, select: { id: true, role: true, username: true } });
    if (!user) throw new BadRequestException(`There is no user "${input.username}" in this business`);
    const admin = user.role === UserRole.ADMIN;
    await this.prisma.user.update({
      where: { id: user.id },
      data: { ...newPasswordFields(await hashPassword(input.newPassword), !admin), ...(admin ? { isActive: true } : {}) }
    });
    return { username: user.username };
  }

  /**
   * Emails an 8-digit code that resets the owner's password (replacing any earlier code). Says
   * nothing about whether the email has an account; fails only when email can't be sent at all.
   */
  async requestPasswordReset(email: string) {
    this.mailer.assertConfigured();
    const control = this.tenancy.control;
    const account = await control.account.findUnique({ where: { email }, select: { id: true } });
    if (!account) return;
    const code = String(randomInt(0, 100_000_000)).padStart(8, '0');
    const codeHash = await hashPassword(code);
    await control.$transaction([
      control.passwordReset.deleteMany({ where: { accountId: account.id } }),
      control.passwordReset.create({
        data: { accountId: account.id, codeHash, expiresAt: new Date(Date.now() + RESET_CODE_MINUTES * 60_000) }
      })
    ]);
    await this.mailer.send({
      to: email,
      subject: `Your Point of Sale password reset code: ${code}`,
      text: [
        `Someone asked to reset the password of the Point of Sale owner account for ${email}.`,
        '',
        `Your code is ${code}. Enter it in the app within ${RESET_CODE_MINUTES} minutes to choose a new password.`,
        '',
        "If this wasn't you, ignore this email: your password stays the same."
      ].join('\n')
    });
  }

  /** The emailed code and a new password. Every owner token signed before it stops working. */
  async confirmPasswordReset(input: { email: string; code: string; newPassword: string }) {
    const refused = new BadRequestException('That code is wrong or has expired. Ask for a new one.');
    const control = this.tenancy.control;
    const account = await control.account.findUnique({ where: { email: input.email }, select: { id: true, emailVerifiedAt: true } });
    if (!account) throw refused;
    const reset = await control.passwordReset.findFirst({
      where: { accountId: account.id, usedAt: null },
      orderBy: { createdAt: 'desc' }
    });
    if (!reset || reset.expiresAt <= new Date() || reset.attempts >= RESET_CODE_TRIES) throw refused;
    if (!(await verifyPassword(input.code, reset.codeHash))) {
      await control.passwordReset.update({ where: { id: reset.id }, data: { attempts: { increment: 1 } } });
      throw refused;
    }
    const passwordHash = await hashPassword(input.newPassword);
    const now = new Date();
    await control.$transaction(async (tx) => {
      // Once only, even if two requests carry the same code.
      const used = await tx.passwordReset.updateMany({ where: { id: reset.id, usedAt: null }, data: { usedAt: now } });
      if (used.count !== 1) throw refused;
      await tx.account.update({
        where: { id: account.id },
        // Reading the code proves the email is theirs.
        data: { passwordHash, passwordChangedAt: now, emailVerifiedAt: account.emailVerifiedAt ?? now }
      });
    });
  }
}
