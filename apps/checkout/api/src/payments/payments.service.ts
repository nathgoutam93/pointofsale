import { randomBytes } from 'crypto';
import type { CheckoutNotification, CheckoutSession, createSessionRequestSchema, NotificationType } from '@hackd/checkout-contracts';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type Session } from '.prisma/checkout-client';
import type { z } from 'zod';
import { AlertsService } from '../alerts/alerts.service';
import { publicUrl } from '../config';
import { escapeHtml, rupees, simplePage } from '../common/page';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DUMMY_SIGNATURE_HEADER, signDummyWebhook } from '../providers/dummy-provider';
import { paymentProvider } from '../providers/providers';
import { InvalidWebhookError, type ProviderPaymentEvent } from '../providers/payment-provider';

/** A product's request as the contract parses it (defaults filled in). */
export type SessionInput = z.output<typeof createSessionRequestSchema>;

/** Session ids go in payers' links, so they can't be guessed: 24 random bytes. */
const newSessionId = () => `ses_${randomBytes(24).toString('base64url')}`;
const newNoticeId = () => `evt_${randomBytes(18).toString('base64url')}`;

/** How long a session's link leads to the provider. Longer would let a payer pay an old price weeks later. */
export const SESSION_LIFETIME_MS = 24 * 60 * 60_000;
/** After its link expires, how long a session still waits for a payment already under way before it closes unpaid. */
export const CLOSE_AFTER_EXPIRY_MS = 30 * 60_000;

const expiredPage = () => simplePage('This payment link has expired', '<p>Nothing more can be paid here. Go back and start the payment again.</p>');

/** What a page shows instead of the provider's: a status code and the HTML. */
export type PayTarget = { redirect: string } | { status: number; page: string };

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly alerts: AlertsService
  ) {}

  /**
   * POST /sessions. The same product and reference again gives back the same session (a product
   * retrying after a timeout), but not for a different amount.
   */
  async createSession(product: string, request: SessionInput): Promise<CheckoutSession> {
    const existing = await this.prisma.session.findUnique({ where: { product_reference: { product, reference: request.reference } } });
    if (existing) return this.sameRequest(existing, request);

    const provider = paymentProvider();
    const id = newSessionId();
    const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
    const payment = await provider.createPayment({
      sessionId: id,
      amount: request.amount,
      currency: request.currency,
      description: request.description,
      customerEmail: request.customer.email,
      customerName: request.customer.name,
      expiresAt
    });
    try {
      const session = await this.prisma.session.create({
        data: {
          id,
          product,
          reference: request.reference,
          amount: request.amount,
          currency: request.currency,
          description: request.description,
          customerEmail: request.customer.email,
          customerName: request.customer.name,
          returnUrl: request.returnUrl,
          metadata: request.metadata,
          provider: provider.name,
          providerRef: payment.providerRef,
          redirectUrl: payment.redirectUrl,
          expiresAt
        }
      });
      return this.view(session);
    } catch (error) {
      // The same reference at the same moment: the other request made it first.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const made = await this.prisma.session.findUnique({ where: { product_reference: { product, reference: request.reference } } });
        if (made) return this.sameRequest(made, request);
      }
      throw error;
    }
  }

  private sameRequest(session: Session, request: SessionInput) {
    if (session.amount !== request.amount || session.currency !== request.currency) {
      throw new ConflictException(`Reference ${request.reference} already has a session for another amount`);
    }
    return this.view(session);
  }

  /** GET /sessions/:id: only the product's own sessions. */
  async session(product: string, id: string) {
    const session = await this.prisma.session.findUnique({ where: { id } });
    if (!session || session.product !== product) throw new NotFoundException();
    return this.view(session);
  }

  view(session: Session): CheckoutSession {
    return {
      id: session.id,
      product: session.product,
      reference: session.reference,
      amount: session.amount,
      currency: 'INR',
      status: session.status as CheckoutSession['status'],
      payUrl: `${publicUrl()}/pay/${session.id}`,
      createdAt: session.createdAt.toISOString(),
      paidAt: session.status === 'paid' && session.settledAt ? session.settledAt.toISOString() : null
    };
  }

  /** GET /pay/:id, opened in the payer's browser (the id is the secret): on to the provider, or why not. */
  async payTarget(id: string): Promise<PayTarget> {
    const session = await this.prisma.session.findUnique({ where: { id } });
    if (!session) return { status: 404, page: simplePage('Payment not found', '<p>Check the link, or start the payment again.</p>') };
    if (session.status === 'paid') {
      if (session.returnUrl) return { redirect: session.returnUrl };
      return { status: 200, page: simplePage('Already paid', '<p>This payment is complete. You can close this window.</p>') };
    }
    // Closed unpaid, or about to: the payer starts again from the product, at today's price.
    if (session.status === 'failed' || session.expiresAt <= new Date()) return { status: 200, page: expiredPage() };
    return { redirect: session.redirectUrl };
  }

  /** POST /webhooks/:provider: only the provider in use, and only with its signature. */
  async receiveWebhook(providerName: string, rawBody: Buffer | undefined, headers: Record<string, string | string[] | undefined>) {
    const provider = paymentProvider();
    if (provider.name !== providerName) throw new NotFoundException();
    let events: ProviderPaymentEvent[];
    try {
      events = provider.parseWebhook(rawBody ?? Buffer.alloc(0), headers);
    } catch (error) {
      if (error instanceof InvalidWebhookError) {
        this.logger.warn(`Refused a ${providerName} webhook: ${error.message}`);
        throw new BadRequestException('Invalid webhook');
      }
      throw error;
    }
    for (const event of events) await this.applyEvent(provider.name, event);
    return { received: events.length };
  }

  /**
   * One provider event, at most once: a retried delivery finds its event recorded and changes
   * nothing. A failed attempt leaves the session open, as the payer can try again on the
   * provider's page until it expires. Money taken counts only for an open session's full amount
   * (the session is paid and its product gets a notice, sent now and retried until it answers);
   * any other is recorded to refund, with an alert.
   */
  async applyEvent(providerName: string, event: ProviderPaymentEvent) {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const recorded = await tx.providerEvent.createMany({ data: [{ provider: providerName, eventId: event.eventId }], skipDuplicates: true });
      if (recorded.count === 0) return null;
      const [locked] = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Session" WHERE provider = ${providerName} AND "providerRef" = ${event.providerRef} FOR UPDATE`;
      const session = locked ? await tx.session.findUniqueOrThrow({ where: { id: locked.id } }) : null;

      if (event.type === 'payment.failed') {
        if (!session) {
          this.logger.warn(`A ${providerName} event for an unknown payment (${event.providerRef}) was ignored`);
        } else if (session.status === 'pending') {
          await tx.session.update({ where: { id: session.id }, data: { failureReason: event.reason?.trim().slice(0, 500) || 'The payment failed' } });
        }
        return null;
      }

      const problem = !session
        ? `it was for a ${providerName} payment this service doesn't know`
        : session.status === 'paid'
          ? `session ${session.id} was already paid`
          : session.status !== 'pending'
            ? `session ${session.id} had already closed unpaid (${session.failureReason ?? session.status})`
            : event.amount !== session.amount
              ? `it was ${rupees(event.amount)}, not the ${rupees(session.amount)} session ${session.id} asked for`
              : null;
      if (problem) {
        await this.recordUncounted(tx, providerName, event, session, problem);
        return { alerted: true };
      }

      const now = new Date();
      await tx.session.update({ where: { id: session!.id }, data: { status: 'paid', settledAt: now, failureReason: null } });
      return { noticeId: await this.queueNotice(tx, session!, 'payment.succeeded', event.amount, null, now) };
    });
    // After the commit; a product that's slow or down doesn't hold up the provider's webhook.
    if (outcome?.noticeId) this.sendNotice(outcome.noticeId);
    if (outcome?.alerted) void this.alerts.sendDue().catch((error) => this.logger.error(error));
  }

  /**
   * Sessions whose link expired (and the wait for a payment already under way after it) close
   * unpaid, and their product is told (payment.failed), so it can let the payer start again.
   */
  async closeExpired() {
    const due = await this.prisma.session.findMany({
      where: { status: 'pending', expiresAt: { lt: new Date(Date.now() - CLOSE_AFTER_EXPIRY_MS) } },
      orderBy: { expiresAt: 'asc' },
      select: { id: true },
      take: 100
    });
    for (const { id } of due) {
      const noticeId = await this.prisma.$transaction(async (tx) => {
        // Locked, as a payment arriving now would be: one or the other settles it.
        const [locked] = await tx.$queryRaw<Array<{ status: string }>>`SELECT status FROM "Session" WHERE id = ${id} FOR UPDATE`;
        if (locked?.status !== 'pending') return null;
        const session = await tx.session.findUniqueOrThrow({ where: { id } });
        const reason = session.failureReason ? `The payment link expired; the last attempt failed: ${session.failureReason}` : 'The payment link expired';
        const now = new Date();
        await tx.session.update({ where: { id }, data: { status: 'failed', settledAt: now, failureReason: reason } });
        return this.queueNotice(tx, session, 'payment.failed', session.amount, reason, now);
      });
      if (noticeId) this.sendNotice(noticeId);
    }
  }

  /** A notice for the session's product, stored with what it's about; sendNotice() sends it after the commit. */
  private async queueNotice(
    tx: Prisma.TransactionClient,
    session: Session,
    type: NotificationType,
    amount: number,
    reason: string | null,
    occurredAt: Date
  ) {
    const id = newNoticeId();
    const notice: CheckoutNotification = {
      id,
      type,
      sessionId: session.id,
      product: session.product,
      reference: session.reference,
      amount,
      currency: 'INR',
      reason,
      metadata: session.metadata as Record<string, string>,
      occurredAt: occurredAt.toISOString()
    };
    await tx.notification.create({ data: { id, sessionId: session.id, product: session.product, type, body: JSON.stringify(notice) } });
    return id;
  }

  private sendNotice(id: string) {
    void this.notifications.deliver(id).catch((error) => this.logger.error(error));
  }

  /** Money the provider took that no session counts: kept to refund, and an alert to the people who can. */
  private async recordUncounted(
    tx: Prisma.TransactionClient,
    providerName: string,
    event: ProviderPaymentEvent,
    session: Session | null,
    problem: string
  ) {
    const id = `unc_${randomBytes(12).toString('base64url')}`;
    await tx.uncountedPayment.create({
      data: { id, provider: providerName, providerRef: event.providerRef, eventId: event.eventId, sessionId: session?.id ?? null, amount: event.amount, reason: problem }
    });
    const lines = [`${providerName} took ${rupees(event.amount)} (${event.amount} paise) that didn't count: ${problem}.`];
    if (session) {
      lines.push(`Session ${session.id}: ${session.product} ${session.reference}, "${session.description}", payer ${session.customerEmail ?? 'unknown'}.`);
    }
    lines.push(
      `${providerName} payment ${event.providerRef}, event ${event.eventId}.`,
      '',
      `Refund it with ${providerName}, then mark it refunded (in the checkout database):`,
      `  UPDATE "UncountedPayment" SET "refundedAt" = now() WHERE id = '${id}';`
    );
    await this.alerts.raise(tx, `Refund ${rupees(event.amount)}: a ${providerName} payment that didn't count`, lines.join('\n'));
  }

  /** CHECKOUT_PROVIDER=dummy: the stand-in provider's page, with a button to pay and one to fail. */
  async dummyPage(providerRef: string): Promise<PayTarget> {
    const session = await this.dummySession(providerRef);
    if (session.status !== 'pending' || session.expiresAt <= new Date()) return this.payTarget(session.id);
    const lastAttempt = session.failureReason ? `<p>That attempt didn't go through (${escapeHtml(session.failureReason)}). Try again.</p>\n` : '';
    const page = simplePage(
      'Test payment',
      `${lastAttempt}<p>${escapeHtml(session.description)}: <strong>${rupees(session.amount)}</strong></p>
<p>No money moves: this is the test provider.</p>
<form method="post"><input type="hidden" name="outcome" value="pay"><button type="submit">Pay</button></form>
<form method="post"><input type="hidden" name="outcome" value="fail"><button type="submit">Fail the payment</button></form>`
    );
    return { status: 200, page };
  }

  /**
   * The dummy page's buttons: a signed webhook through the same path a real provider's takes. As
   * a real provider's page, it takes nothing more once the session is settled, but a page opened
   * before the link expired can still pay until the session closes.
   */
  async dummyComplete(providerRef: string, outcome: unknown): Promise<PayTarget> {
    const session = await this.dummySession(providerRef);
    if (outcome !== 'pay' && outcome !== 'fail') throw new BadRequestException('outcome must be pay or fail');
    if (session.status !== 'pending') return this.payTarget(session.id);
    const body = Buffer.from(
      JSON.stringify({
        eventId: `dummy_evt_${randomBytes(12).toString('hex')}`,
        type: outcome === 'pay' ? 'payment.succeeded' : 'payment.failed',
        providerRef,
        amount: session.amount,
        reason: outcome === 'pay' ? undefined : 'Failed on the test page'
      })
    );
    await this.receiveWebhook('dummy', body, { [DUMMY_SIGNATURE_HEADER]: signDummyWebhook(body) });
    const after = await this.prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    if (after.status !== 'paid') return this.dummyPage(providerRef);
    if (after.returnUrl) return { redirect: after.returnUrl };
    return { status: 200, page: simplePage('Payment received', '<p>Thank you. You can close this window.</p>') };
  }

  private async dummySession(providerRef: string) {
    if (paymentProvider().name !== 'dummy') throw new NotFoundException();
    const session = await this.prisma.session.findUnique({ where: { provider_providerRef: { provider: 'dummy', providerRef } } });
    if (!session) throw new NotFoundException();
    return session;
  }
}
