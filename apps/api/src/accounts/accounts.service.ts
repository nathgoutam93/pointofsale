import { BadRequestException, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { EMAIL_VERIFICATION_REQUIRED } from '@pos/contracts';
import { UserRole } from '@prisma/client';
import { randomInt } from 'crypto';
import { hashPassword, newPasswordFields, verifyPassword } from '../auth/password';
import { signedBeforePasswordChange, verifyAccountToken } from '../auth/token';
import { Mailer } from '../mail/mailer';
import { lockBusiness } from '../common/locks';
import { PrismaService } from '../prisma.service';
import { TenancyService } from '../tenancy/tenancy.service';

/** How long an emailed code (reset, verification) works, and how many wrong tries it allows. */
const RESET_CODE_MINUTES = 15;
const RESET_CODE_TRIES = 5;

/** 8 random digits. */
const newEmailCode = () => String(randomInt(0, 100_000_000)).padStart(8, '0');

/**
 * Owners must prove their email address before it creates a business or moves one online.
 * OWNER_EMAIL_VERIFICATION=off turns that off (development without email; tests).
 */
export const ownerEmailVerificationRequired = () => (process.env.OWNER_EMAIL_VERIFICATION ?? '').trim().toLowerCase() !== 'off';

/** Business owners' accounts on the hosted server (email and password, in the control schema). */
@Injectable()
export class AccountsService {
  private readonly logger = new Logger('Accounts');

  constructor(
    private readonly tenancy: TenancyService,
    private readonly prisma: PrismaService,
    private readonly mailer: Mailer
  ) {}

  /**
   * The account for `email`, created on first use; an existing one needs its password. An
   * address not yet verified (a new one, or one from before verification) needs the code
   * emailed to it: without `emailCode`, a code is sent and the answer asks for it.
   */
  async findOrCreate(email: string, password: string, emailCode?: string) {
    const control = this.tenancy.control;
    const existing = await control.account.findUnique({ where: { email } });
    if (existing && !(await verifyPassword(password, existing.passwordHash))) {
      throw new BadRequestException('This email already has an account; enter its password');
    }
    const verify = ownerEmailVerificationRequired() && !existing?.emailVerifiedAt;
    if (verify) {
      if (!emailCode) {
        await this.sendVerificationCode(email);
        throw new BadRequestException({
          statusCode: 400,
          code: EMAIL_VERIFICATION_REQUIRED,
          message: `We emailed a code to ${email}. Enter it to continue.`
        });
      }
      await this.useVerificationCode(email, emailCode);
    }
    const verifiedAt = verify ? new Date() : undefined;
    if (existing) {
      return verifiedAt ? control.account.update({ where: { id: existing.id }, data: { emailVerifiedAt: verifiedAt } }) : existing;
    }
    return control.account.create({ data: { email, passwordHash: await hashPassword(password), emailVerifiedAt: verifiedAt ?? null } });
  }

  /** Emails a verification code to `email`, replacing any earlier one. */
  private async sendVerificationCode(email: string) {
    this.mailer.assertConfigured();
    const control = this.tenancy.control;
    const code = newEmailCode();
    const codeHash = await hashPassword(code);
    await control.$transaction([
      control.emailVerification.deleteMany({ where: { email } }),
      control.emailVerification.create({ data: { email, codeHash, expiresAt: new Date(Date.now() + RESET_CODE_MINUTES * 60_000) } })
    ]);
    await this.mailer.send({
      to: email,
      subject: `Your Point of Sale verification code: ${code}`,
      text: [
        `Your code is ${code}. Enter it in the app within ${RESET_CODE_MINUTES} minutes to confirm this is your email address.`,
        '',
        'It is asked for once, the first time this address creates a business or moves one online.',
        "If this wasn't you, ignore this email: nothing is created without the code."
      ].join('\n')
    });
  }

  /** Checks and spends the latest code emailed to `email`; a wrong one counts against it. */
  private async useVerificationCode(email: string, code: string) {
    const refused = new BadRequestException("That code is wrong or has expired. Leave it empty and try again to get a new one.");
    const control = this.tenancy.control;
    const sent = await control.emailVerification.findFirst({ where: { email, usedAt: null }, orderBy: { createdAt: 'desc' } });
    if (!sent || sent.expiresAt <= new Date() || sent.attempts >= RESET_CODE_TRIES) throw refused;
    if (!(await verifyPassword(code, sent.codeHash))) {
      await control.emailVerification.update({ where: { id: sent.id }, data: { attempts: { increment: 1 } } });
      throw refused;
    }
    const used = await control.emailVerification.updateMany({ where: { id: sent.id, usedAt: null }, data: { usedAt: new Date() } });
    if (used.count !== 1) throw refused;
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

  /**
   * Tells the owner their business is ready (created, or moved online) with its code, which
   * every other computer signs in with. Best effort: the business exists either way.
   */
  async notifyBusinessReady(accountId: string, business: { name: string; code: string }, how: 'created' | 'moved') {
    const account = await this.tenancy.control.account.findUnique({ where: { id: accountId }, select: { email: true } });
    if (!account) return;
    await this.mailer.sendNotice({
      to: account.email,
      subject: `${business.name} is online. Business code: ${business.code}`,
      text: [
        how === 'moved'
          ? `${business.name} has moved online, with everything that was on the computer it ran on.`
          : `${business.name} is ready on Point of Sale.`,
        '',
        `Business code: ${business.code}`,
        '',
        'Staff sign in on any computer with this code, their username and their password. On a new computer, choose "Join an existing business".',
        'Keep this email somewhere safe.'
      ].join('\n')
    });
  }

  async businessesOf(accountId: string) {
    const memberships = await this.tenancy.control.membership.findMany({
      where: { accountId },
      orderBy: { createdAt: 'asc' },
      select: { business: { select: { id: true, code: true, name: true, status: true } } }
    });
    return memberships.map((membership) => membership.business);
  }

  /** Makes the rest of the request work in one of the owner's businesses. */
  private async enterOwned(accountId: string, businessId: string) {
    const membership = await this.tenancy.control.membership.findUnique({
      where: { accountId_businessId: { accountId, businessId } },
      select: { role: true }
    });
    if (!membership) throw new ForbiddenException("That business isn't one of yours");
    await this.tenancy.enterById(businessId).catch(() => {
      throw new BadRequestException("This business isn't active");
    });
  }

  /** The staff of one of the owner's businesses: admins first, then by name. */
  async staffOf(accountId: string, businessId: string) {
    await this.enterOwned(accountId, businessId);
    const users = await this.prisma.user.findMany({
      select: {
        id: true,
        username: true,
        role: true,
        isActive: true,
        mustChangePassword: true,
        createdAt: true,
        branch: { select: { name: true } },
        _count: { select: { branchAccesses: true } }
      }
    });
    return users
      .map((user) => ({
        id: user.id,
        username: user.username,
        role: user.role,
        branchName: user.branch.name,
        branchCount: Math.max(1, user._count.branchAccesses),
        isActive: user.isActive,
        mustChangePassword: user.mustChangePassword,
        createdAt: user.createdAt.toISOString()
      }))
      .sort((a, b) => (a.role === b.role ? a.username.localeCompare(b.username) : a.role === UserRole.ADMIN ? -1 : 1));
  }

  /**
   * An owner turns a staff user off (signed out everywhere: each request checks isActive) or on.
   * The business keeps at least one active admin, so someone can still run it.
   */
  async setStaffActive(accountId: string, input: { businessId: string; username: string; isActive: boolean }) {
    await this.enterOwned(accountId, input.businessId);
    return this.prisma.$transaction(async (tx) => {
      await lockBusiness(tx, 'staff-active');
      const user = await tx.user.findUnique({ where: { username: input.username }, select: { id: true, role: true, username: true, isActive: true } });
      if (!user) throw new BadRequestException(`There is no user "${input.username}" in this business`);
      if (!input.isActive && user.role === UserRole.ADMIN && user.isActive) {
        const otherAdmins = await tx.user.count({ where: { role: UserRole.ADMIN, isActive: true, id: { not: user.id } } });
        if (otherAdmins === 0) throw new BadRequestException(`${user.username} is the only active admin. Turn another admin on first, or give ${user.username} a new password instead.`);
      }
      await tx.user.update({ where: { id: user.id }, data: { isActive: input.isActive } });
      return { username: user.username, isActive: input.isActive };
    });
  }

  /**
   * An owner gives a staff user of their business a new password (an admin who forgot theirs).
   * Their sessions end. An admin is reactivated; a cashier chooses their own at next sign-in.
   */
  async resetStaffPassword(accountId: string, input: { businessId: string; username: string; newPassword: string }) {
    await this.enterOwned(accountId, input.businessId);
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
    const code = newEmailCode();
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
    await this.mailer.sendNotice({
      to: input.email,
      subject: 'Your Point of Sale owner password was changed',
      text: [
        `The password of the Point of Sale owner account for ${input.email} was just changed with a code sent to this address.`,
        'Anywhere the account was signed in has been signed out.',
        '',
        "If this wasn't you, reset the password again right away (Forgot your owner password? in the app) and contact support."
      ].join('\n')
    });
  }
}
