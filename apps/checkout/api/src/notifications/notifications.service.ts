import { CHECKOUT_SIGNATURE_HEADER, signNotification } from '@hackd/checkout-contracts';
import { Injectable, Logger } from '@nestjs/common';
import { AlertsService } from '../alerts/alerts.service';
import { product } from '../config';
import { PrismaService } from '../common/prisma.service';
import { retryDelayMs } from '../common/retry';

/** After this many failed attempts a notice is left alone and an alert says so; about two and a half days. */
export const MAX_ATTEMPTS = 20;
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Sends products their notices: right after a payment, then again on the timer (JobsService)
 * until the product answers 2xx. Each attempt is signed afresh (the signature carries its time);
 * the body and its id stay the same, so the product can tell a retry from a new event.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly sending = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService
  ) {}

  /** Every notice whose next attempt is due. */
  async deliverDue() {
    const due = await this.prisma.notification.findMany({
      where: { deliveredAt: null, attempts: { lt: MAX_ATTEMPTS }, nextAttemptAt: { lte: new Date() } },
      orderBy: { nextAttemptAt: 'asc' },
      select: { id: true },
      take: 50
    });
    for (const { id } of due) await this.deliver(id);
  }

  /** One attempt at a notice, unless it's delivered or already being sent. True once delivered. */
  async deliver(id: string): Promise<boolean> {
    if (this.sending.has(id)) return false;
    this.sending.add(id);
    try {
      const notice = await this.prisma.notification.findUnique({ where: { id } });
      if (!notice) return false;
      if (notice.deliveredAt) return true;
      const target = product(notice.product);
      let error: string | null = null;
      if (!target) {
        error = `${notice.product} is no longer in CHECKOUT_PRODUCTS`;
      } else {
        try {
          const response = await fetch(target.notifyUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json', [CHECKOUT_SIGNATURE_HEADER]: signNotification(target.notifySecret, notice.body) },
            body: notice.body,
            redirect: 'error',
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
          });
          if (!response.ok) error = `${target.notifyUrl} answered ${response.status}`;
          // Read and drop the answer so the connection can be reused.
          await response.arrayBuffer().catch(() => undefined);
        } catch (cause) {
          error = `${target.notifyUrl}: ${cause instanceof Error ? cause.message : String(cause)}`;
        }
      }
      if (!error) {
        await this.prisma.notification.update({ where: { id }, data: { attempts: { increment: 1 }, deliveredAt: new Date(), lastError: null } });
        return true;
      }
      const attempts = notice.attempts + 1;
      const lastError = error.slice(0, 500);
      if (attempts < MAX_ATTEMPTS) {
        await this.prisma.notification.update({ where: { id }, data: { attempts, nextAttemptAt: new Date(Date.now() + retryDelayMs(attempts)), lastError } });
        this.logger.warn(`Notice ${id} to ${notice.product} not delivered (attempt ${attempts} of ${MAX_ATTEMPTS}): ${error}`);
        return false;
      }
      // The last attempt: the product's record of this payment stays wrong until someone acts.
      await this.prisma.$transaction(async (tx) => {
        await tx.notification.update({ where: { id }, data: { attempts, lastError } });
        await this.alerts.raise(
          tx,
          `${notice.product} never took notice ${id} (${notice.type})`,
          [
            `The checkout service sent ${notice.product} this notice ${attempts} times and gave up. Its last error: ${lastError}`,
            `Until it arrives, ${notice.product}'s record of session ${notice.sessionId} is out of date.`,
            '',
            notice.body,
            '',
            `Once ${notice.product} can take it, send it again (in the checkout database):`,
            `  UPDATE "Notification" SET attempts = 0, "nextAttemptAt" = now() WHERE id = '${id}';`
          ].join('\n')
        );
      });
      void this.alerts.sendDue().catch((cause) => this.logger.error(cause));
      return false;
    } finally {
      this.sending.delete(id);
    }
  }
}
