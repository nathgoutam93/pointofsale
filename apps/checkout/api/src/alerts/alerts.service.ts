import { randomBytes } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '.prisma/checkout-client';
import { alertRecipients, mailMode } from '../config';
import { PrismaService } from '../common/prisma.service';
import { retryDelayMs } from '../common/retry';
import { sendMail } from './mail';

/**
 * Emails to the people who run the service (CHECKOUT_ALERT_EMAIL) about something only they can
 * fix: money to refund, a product that never took a notice. Each is stored first, in the same
 * transaction as what it's about, then sent until it goes out, so none is lost to a mail outage.
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);
  private sending: Promise<void> | null = null;
  private again = false;

  constructor(private readonly prisma: PrismaService) {}

  /** Stores an alert (with `db`, inside the caller's transaction) and logs it; sendDue() emails it. */
  async raise(db: Prisma.TransactionClient, subject: string, text: string) {
    this.logger.error(`${subject}\n${text}`);
    await db.alert.create({ data: { id: `alr_${randomBytes(12).toString('base64url')}`, subject, text } });
  }

  /** Emails every alert that's due. Alerts wait, unsent, while email isn't set up. */
  sendDue(): Promise<void> {
    // One run at a time; an alert raised during a run is picked up by one more run after it.
    if (this.sending) {
      this.again = true;
      return this.sending;
    }
    this.sending = (async () => {
      try {
        do {
          this.again = false;
          await this.sendBatch();
        } while (this.again);
      } finally {
        this.sending = null;
      }
    })();
    return this.sending;
  }

  private async sendBatch() {
    const to = alertRecipients();
    if (to.length === 0 || mailMode() === null) return;
    const due = await this.prisma.alert.findMany({
      where: { sentAt: null, nextAttemptAt: { lte: new Date() } },
      orderBy: { createdAt: 'asc' },
      take: 20
    });
    for (const alert of due) {
      try {
        await sendMail({ to, subject: `[checkout] ${alert.subject}`, text: alert.text });
        await this.prisma.alert.update({ where: { id: alert.id }, data: { attempts: { increment: 1 }, sentAt: new Date(), lastError: null } });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const attempts = alert.attempts + 1;
        await this.prisma.alert.update({
          where: { id: alert.id },
          data: { attempts, nextAttemptAt: new Date(Date.now() + retryDelayMs(attempts)), lastError: message.slice(0, 500) }
        });
        this.logger.error(`Alert ${alert.id} not emailed (attempt ${attempts}): ${message}`);
      }
    }
  }
}
