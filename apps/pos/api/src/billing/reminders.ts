import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { billingStateAt } from '@pos/contracts';
import { isOffline } from '../common/mode';
import { Mailer } from '../mail/mailer';
import { TenancyService } from '../tenancy/tenancy.service';
import { BillingService } from './billing.service';
import { billingEnforced } from './gateways';

const HOUR_MS = 60 * 60 * 1000;
/** How long before the trial or paid time ends the first reminder goes. */
const ENDING_SOON_MS = 3 * 24 * HOUR_MS;

const day = (date: Date) => date.toLocaleDateString('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' });

/**
 * The reminder a business is due at `now`, if any. Its key names the kind and the end date it
 * is about, so each goes once, and paying (which clears the last one sent) starts afresh.
 */
export function reminderFor(business: { name: string; trialEndsAt: Date | null; paidUntil: Date | null }, now: Date) {
  const { state, endsAt, graceEndsAt } = billingStateAt(business, now);
  if (!endsAt || !graceEndsAt) return null;
  const about = endsAt.toISOString();
  const pay = 'An admin can pay under Settings → Billing in the app.';
  if ((state === 'trial' || state === 'active') && endsAt.getTime() - now.getTime() <= ENDING_SOON_MS) {
    const what = state === 'trial' ? 'free trial' : 'subscription';
    return {
      key: `ending:${about}`,
      subject: `${business.name}: the ${what} ends on ${day(endsAt)}`,
      text: `The Point of Sale ${what} for ${business.name} ends on ${day(endsAt)}. ${pay}`
    };
  }
  if (state === 'past_due') {
    return {
      key: `grace:${about}`,
      subject: `${business.name}: payment due by ${day(graceEndsAt)}`,
      text: [
        `The Point of Sale subscription for ${business.name} ended on ${day(endsAt)}.`,
        `Everything keeps working until ${day(graceEndsAt)}; after that the business is read-only (sales and changes stop) until it is paid. ${pay}`
      ].join('\n')
    };
  }
  if (state === 'read_only') {
    return {
      key: `read-only:${about}`,
      subject: `${business.name} is read-only until the subscription is paid`,
      text: [
        `${business.name} can't make sales or changes until its Point of Sale subscription is paid. Its data is safe, and staff can still sign in and see it.`,
        pay
      ].join('\n')
    };
  }
  return null;
}

/** Managed hosting: emails owners about trials and subscriptions ending, checked every hour. */
@Injectable()
export class BillingReminders implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Billing');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly tenancy: TenancyService,
    private readonly billing: BillingService,
    private readonly mailer: Mailer
  ) {}

  onModuleInit() {
    if (isOffline()) return;
    this.timer = setInterval(() => {
      this.sendDue().catch((error) => this.logger.error(`Billing reminders failed: ${error instanceof Error ? error.message : String(error)}`));
    }, HOUR_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Sends each business the reminder it is due, once: the business row is claimed first, so
   * several API processes never send the same one. Answers how many businesses were reminded.
   */
  async sendDue(now = new Date()) {
    if (!billingEnforced()) return 0;
    const control = this.tenancy.control;
    const businesses = await control.business.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, trialEndsAt: true, paidUntil: true, billingNotice: true }
    });
    let reminded = 0;
    for (const business of businesses) {
      const reminder = reminderFor(business, now);
      if (!reminder || reminder.key === business.billingNotice) continue;
      const claimed = await control.business.updateMany({
        where: { id: business.id, billingNotice: business.billingNotice },
        data: { billingNotice: reminder.key }
      });
      if (claimed.count !== 1) continue;
      for (const to of await this.billing.ownerEmails(business.id)) {
        await this.mailer.sendNotice({ to, subject: reminder.subject, text: reminder.text });
      }
      reminded += 1;
    }
    return reminded;
  }
}
