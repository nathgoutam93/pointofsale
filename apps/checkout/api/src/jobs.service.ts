import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AlertsService } from './alerts/alerts.service';
import { timerSeconds } from './config';
import { NotificationsService } from './notifications/notifications.service';
import { PaymentsService } from './payments/payments.service';

/**
 * The service's timed work, every CHECKOUT_TIMER_SECONDS: closing sessions that expired unpaid,
 * then sending again the notices and alerts that didn't go out.
 */
@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly payments: PaymentsService,
    private readonly notifications: NotificationsService,
    private readonly alerts: AlertsService
  ) {}

  onModuleInit() {
    const seconds = timerSeconds();
    if (seconds > 0) {
      this.timer = setInterval(() => void this.run(), seconds * 1000);
      this.timer.unref();
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** One round; a round still going when the next is due lets it pass. */
  async run() {
    if (this.running) return;
    this.running = true;
    try {
      for (const job of [() => this.payments.closeExpired(), () => this.notifications.deliverDue(), () => this.alerts.sendDue()]) {
        // One job failing (the database away for a moment) doesn't stop the others.
        await job().catch((error) => this.logger.error(error));
      }
    } finally {
      this.running = false;
    }
  }
}
