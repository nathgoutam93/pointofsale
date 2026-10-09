import { BadRequestException, ForbiddenException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomInt } from 'crypto';
import { rm } from 'fs/promises';
import { join } from 'path';
import { hashPassword, verifyPassword } from '../auth/password';
import { isOffline } from '../common/mode';
import { uploadsDir } from '../common/uploads';
import { Mailer } from '../mail/mailer';
import { TenancyService } from '../tenancy/tenancy.service';
import { TenantClients } from '../tenancy/tenant-clients';

/** How long a deleted business stays locked, recoverable, before it is erased. */
export const DELETION_GRACE_DAYS = 7;
const CODE_MINUTES = 15;
const CODE_TRIES = 5;
const HOUR_MS = 60 * 60 * 1000;

/** Uploads a business's data points to (/uploads/…), never outside the folder. */
const uploadPath = (url: string | null | undefined) =>
  url && url.startsWith('/uploads/') && !url.includes('..') ? join(uploadsDir, url.slice('/uploads/'.length)) : null;

/**
 * An owner deletes one of their businesses from the hosted platform, proving it is them twice:
 * their password and a code emailed to them (and typing the business code, so it isn't the
 * wrong one). The business is locked at once (nobody can sign in) and erased after
 * DELETION_GRACE_DAYS unless an owner cancels: its schema with every sale, item and customer,
 * the files it uploaded, its owners' access and its crash reports. What stays is the
 * platform's own record of it: the business row (its name removed) and the invoices the
 * platform issued it, which the law requires keeping.
 */
@Injectable()
export class BusinessDeletionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('BusinessDeletion');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly tenancy: TenancyService,
    private readonly clients: TenantClients,
    private readonly mailer: Mailer
  ) {}

  onModuleInit() {
    if (isOffline()) return;
    this.timer = setInterval(() => {
      this.eraseDue().catch((error) => this.logger.error(`Erasing deleted businesses failed: ${error instanceof Error ? error.message : String(error)}`));
    }, HOUR_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** The business, when the account owns it. */
  private async owned(accountId: string, businessId: string) {
    const membership = await this.tenancy.control.membership.findUnique({
      where: { accountId_businessId: { accountId, businessId } },
      select: { account: { select: { email: true, passwordHash: true } }, business: true }
    });
    if (!membership) throw new ForbiddenException("That business isn't one of yours");
    return membership;
  }

  private async ownerEmails(businessId: string) {
    const memberships = await this.tenancy.control.membership.findMany({ where: { businessId }, select: { account: { select: { email: true } } } });
    return memberships.map((membership) => membership.account.email);
  }

  /** Emails the owner a code that, with their password, deletes the business. */
  async sendCode(accountId: string, businessId: string) {
    this.mailer.assertConfigured();
    const { account, business } = await this.owned(accountId, businessId);
    if (business.status !== 'ACTIVE' && business.status !== 'SUSPENDED') throw new BadRequestException(`${business.name} can't be deleted now`);
    const code = String(randomInt(0, 100_000_000)).padStart(8, '0');
    const control = this.tenancy.control;
    await control.$transaction([
      control.deletionCode.deleteMany({ where: { accountId, businessId } }),
      control.deletionCode.create({ data: { accountId, businessId, codeHash: await hashPassword(code), expiresAt: new Date(Date.now() + CODE_MINUTES * 60_000) } })
    ]);
    await this.mailer.send({
      to: account.email,
      subject: `Code to delete ${business.name}: ${code}`,
      text: [
        `Someone signed in to the Point of Sale owner account ${account.email} and asked to delete the business ${business.name} (code ${business.code}).`,
        '',
        `To go ahead, enter this code with your password within ${CODE_MINUTES} minutes: ${code}`,
        '',
        `The business will be locked at once and its data erased for good ${DELETION_GRACE_DAYS} days later, unless an owner cancels before then.`,
        '',
        "If this wasn't you, don't share the code, and change your owner password now."
      ].join('\n')
    });
  }

  /**
   * Deletes the business with the owner's password, the emailed code and its business code typed
   * again: locked now, erased after the grace period.
   */
  async requestDeletion(accountId: string, businessId: string, input: { password: string; code: string; businessCode: string }) {
    const { account, business } = await this.owned(accountId, businessId);
    if (business.status !== 'ACTIVE' && business.status !== 'SUSPENDED') throw new BadRequestException(`${business.name} can't be deleted now`);
    if (input.businessCode.trim().toUpperCase() !== business.code) throw new BadRequestException(`Type the business code, ${business.code}, to confirm`);
    if (!(await verifyPassword(input.password, account.passwordHash))) throw new BadRequestException('That password is wrong');
    const refused = new BadRequestException('That code is wrong or has expired. Ask for a new one.');
    const control = this.tenancy.control;
    const sent = await control.deletionCode.findFirst({ where: { accountId, businessId, usedAt: null }, orderBy: { createdAt: 'desc' } });
    if (!sent || sent.expiresAt <= new Date() || sent.attempts >= CODE_TRIES) throw refused;
    if (!(await verifyPassword(input.code, sent.codeHash))) {
      await control.deletionCode.update({ where: { id: sent.id }, data: { attempts: { increment: 1 } } });
      throw refused;
    }
    const deleteAfter = new Date(Date.now() + DELETION_GRACE_DAYS * 24 * HOUR_MS);
    await control.$transaction(async (tx) => {
      // Once only, even if two requests carry the same code.
      const used = await tx.deletionCode.updateMany({ where: { id: sent.id, usedAt: null }, data: { usedAt: new Date() } });
      if (used.count !== 1) throw refused;
      await tx.business.update({
        where: { id: businessId },
        data: { status: 'DELETING', statusBeforeDeletion: business.status, deletionRequestedBy: accountId, deleteAfter }
      });
    });
    this.tenancy.forget(businessId);
    this.logger.log(`Business ${business.code} will be erased after ${deleteAfter.toISOString()}`);
    const when = deleteAfter.toUTCString();
    for (const to of await this.ownerEmails(businessId)) {
      await this.mailer.sendNotice({
        to,
        subject: `${business.name} will be deleted on ${when}`,
        text: [
          `${account.email} deleted the business ${business.name} (code ${business.code}). It is locked now: nobody can sign in.`,
          '',
          `Its data will be erased for good on ${when}. Until then an owner can cancel: sign in as the owner in the app and choose "Keep this business".`
        ].join('\n')
      });
    }
    return { id: businessId, status: 'DELETING' as const, deleteAfter: deleteAfter.toISOString() };
  }

  /** An owner changes their mind within the grace period, with their password: the business is back as it was. */
  async cancelDeletion(accountId: string, businessId: string, password: string) {
    const { account, business } = await this.owned(accountId, businessId);
    if (business.status !== 'DELETING') throw new BadRequestException(`${business.name} isn't being deleted`);
    if (!(await verifyPassword(password, account.passwordHash))) throw new BadRequestException('That password is wrong');
    const restored = business.statusBeforeDeletion === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE';
    const { count } = await this.tenancy.control.business.updateMany({
      where: { id: businessId, status: 'DELETING' },
      data: { status: restored, statusBeforeDeletion: null, deletionRequestedBy: null, deleteAfter: null }
    });
    if (count !== 1) throw new BadRequestException(`${business.name} isn't being deleted`);
    this.tenancy.forget(businessId);
    for (const to of await this.ownerEmails(businessId)) {
      await this.mailer.sendNotice({ to, subject: `${business.name} won't be deleted`, text: `${account.email} cancelled deleting ${business.name} (code ${business.code}). It works as before.` });
    }
    return { id: businessId, status: restored };
  }

  /** Erases every business whose grace period is over; answers how many. */
  async eraseDue(now = new Date()) {
    const due = await this.tenancy.control.business.findMany({
      where: { OR: [{ status: 'DELETING', deleteAfter: { lte: now } }, { status: 'DELETED', erasedAt: null }] },
      select: { id: true }
    });
    let erased = 0;
    for (const { id } of due) {
      if (await this.erase(id, now)) erased += 1;
    }
    return erased;
  }

  /**
   * Erases one business, claimed first so two API processes never both do. Each step can run
   * again (a crash halfway leaves it DELETED with erasedAt unset, and a rerun of erase finishes).
   */
  async erase(businessId: string, now = new Date()) {
    const control = this.tenancy.control;
    const claimed = await control.business.updateMany({ where: { id: businessId, status: 'DELETING', deleteAfter: { lte: now } }, data: { status: 'DELETED' } });
    const business = await control.business.findUniqueOrThrow({ where: { id: businessId } });
    // Claimed now, or claimed before and stopped halfway: finish it.
    if (claimed.count !== 1 && !(business.status === 'DELETED' && !business.erasedAt)) return false;
    this.tenancy.forget(businessId);
    const owners = await this.ownerEmails(businessId);

    // Its files, found from its own data, then its schema.
    const { client, release } = await this.clients.acquire(business);
    try {
      const files = await client
        .$queryRawUnsafe<Array<{ url: string | null }>>(
          `SELECT "imageUrl" AS url FROM "Item" UNION ALL SELECT "logoUrl" FROM "Branch" UNION ALL SELECT "logoUrl" FROM "BusinessSettings"`
        )
        .catch(() => [] as Array<{ url: string | null }>);
      for (const file of files) {
        const path = uploadPath(file.url);
        if (path) await rm(path, { force: true });
      }
      await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${business.schemaName.replace(/"/g, '')}" CASCADE`);
    } finally {
      release();
      this.clients.discard(business);
    }
    await rm(join(uploadsDir, 'imported', business.id), { recursive: true, force: true });

    // What the platform kept about it, apart from the invoices it issued.
    await control.$transaction([
      control.membership.deleteMany({ where: { businessId } }),
      control.deletionCode.deleteMany({ where: { businessId } }),
      control.crashReport.deleteMany({ where: { businessId } }),
      control.business.update({ where: { id: businessId }, data: { name: 'Deleted business', importId: null, erasedAt: now } })
    ]);
    this.logger.log(`Business ${business.code} erased`);
    for (const to of owners) {
      await this.mailer.sendNotice({ to, subject: `${business.name} has been deleted`, text: `The business ${business.name} (code ${business.code}) and all its data have been erased from Point of Sale.` });
    }
    return true;
  }
}
