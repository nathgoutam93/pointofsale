import { CHECKOUT_SIGNATURE_HEADER, signNotification } from '@hackd/checkout-contracts';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { notifyIntervalSeconds, product } from '../config';
import { PrismaService } from '../common/prisma.service';

/** After this many failed attempts a notice is left alone (lastError says why); about 4 days. */
export const MAX_ATTEMPTS = 20;
const FIRST_RETRY_MS = 30_000;
const LONGEST_WAIT_MS = 6 * 60 * 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

/** How long to wait after the nth failed attempt: 30 s, doubling, at most 6 hours. */
export const retryDelayMs = (attempts: number) => Math.min(FIRST_RETRY_MS * 2 ** Math.max(attempts - 1, 0), LONGEST_WAIT_MS);

/**
 * Sends products their notices: right after a payment, then again on a timer until the product
 * answers 2xx. Each attempt is signed afresh (the signature carries its time); the body and its
 * id stay the same, so the product can tell a retry from a new event.
 */
@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly sending = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    const seconds = notifyIntervalSeconds();
    if (seconds > 0) {
      this.timer = setInterval(() => void this.deliverDue().catch((error) => this.logger.error(error)), seconds * 1000);
      this.timer.unref();
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

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
      await this.prisma.notification.update({
        where: { id },
        data: { attempts, nextAttemptAt: new Date(Date.now() + retryDelayMs(attempts)), lastError: error.slice(0, 500) }
      });
      const level = attempts >= MAX_ATTEMPTS ? 'error' : 'warn';
      this.logger[level](`Notice ${id} to ${notice.product} not delivered (attempt ${attempts} of ${MAX_ATTEMPTS}): ${error}`);
      return false;
    } finally {
      this.sending.delete(id);
    }
  }
}
