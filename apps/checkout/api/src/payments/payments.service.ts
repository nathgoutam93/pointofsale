import { randomBytes } from 'crypto';
import type { CheckoutNotification, CheckoutSession, createSessionRequestSchema, NotificationType } from '@hackd/checkout-contracts';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type Session } from '.prisma/checkout-client';
import type { z } from 'zod';
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

/** What a page shows instead of the provider's: a status code and the HTML. */
export type PayTarget = { redirect: string } | { status: number; page: string };

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService
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
    const payment = await provider.createPayment({
      sessionId: id,
      amount: request.amount,
      currency: request.currency,
      description: request.description,
      customerEmail: request.customer.email,
      customerName: request.customer.name
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
          redirectUrl: payment.redirectUrl
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
    if (session.status === 'failed') {
      return {
        status: 200,
        page: simplePage("This payment didn't go through", '<p>Nothing more can be paid here. Go back and start the payment again.</p>')
      };
    }
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
   * nothing. A payment counts only for the session's full amount. The session's product gets a
   * notice, sent now and retried until it answers.
   */
  async applyEvent(providerName: string, event: ProviderPaymentEvent) {
    const noticeId = await this.prisma.$transaction(async (tx) => {
      const recorded = await tx.providerEvent.createMany({ data: [{ provider: providerName, eventId: event.eventId }], skipDuplicates: true });
      if (recorded.count === 0) return null;
      const [locked] = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Session" WHERE provider = ${providerName} AND "providerRef" = ${event.providerRef} FOR UPDATE`;
      if (!locked) {
        this.logger.warn(`A ${providerName} event for an unknown payment (${event.providerRef}) was ignored`);
        return null;
      }
      const session = await tx.session.findUniqueOrThrow({ where: { id: locked.id } });
      if (session.status !== 'pending') {
        if (event.type === 'payment.succeeded') {
          // The provider took money for a session that had already closed: someone must refund it.
          this.logger.error(
            `${providerName} payment ${event.providerRef} of ${event.amount} paise arrived for session ${session.id} (${session.product} ` +
              `${session.reference}), which is already ${session.status}. Not counted: refund it with the provider.`
          );
        }
        return null;
      }

      const paid = event.type === 'payment.succeeded' && event.amount === session.amount;
      let reason: string | null = null;
      if (!paid) {
        reason =
          event.type === 'payment.succeeded'
            ? `Paid ${event.amount} paise, not the ${session.amount} asked for`
            : (event.reason?.trim().slice(0, 500) ?? 'The payment failed');
        if (event.type === 'payment.succeeded') this.logger.error(`Session ${session.id}: ${reason}; not counted, refund it with the provider.`);
      }
      const now = new Date();
      await tx.session.update({ where: { id: session.id }, data: { status: paid ? 'paid' : 'failed', settledAt: now, failureReason: reason } });

      const type: NotificationType = paid ? 'payment.succeeded' : 'payment.failed';
      const id = newNoticeId();
      const notice: CheckoutNotification = {
        id,
        type,
        sessionId: session.id,
        product: session.product,
        reference: session.reference,
        amount: event.amount,
        currency: 'INR',
        reason,
        metadata: session.metadata as Record<string, string>,
        occurredAt: now.toISOString()
      };
      await tx.notification.create({ data: { id, sessionId: session.id, product: session.product, type, body: JSON.stringify(notice) } });
      return id;
    });
    // After the commit; a product that's slow or down doesn't hold up the provider's webhook.
    if (noticeId) void this.notifications.deliver(noticeId).catch((error) => this.logger.error(error));
  }

  /** CHECKOUT_PROVIDER=dummy: the stand-in provider's page, with a button to pay and one to fail. */
  async dummyPage(providerRef: string): Promise<PayTarget> {
    const session = await this.dummySession(providerRef);
    if (session.status !== 'pending') return this.payTarget(session.id);
    const page = simplePage(
      'Test payment',
      `<p>${escapeHtml(session.description)}: <strong>${rupees(session.amount)}</strong></p>
<p>No money moves: this is the test provider.</p>
<form method="post"><input type="hidden" name="outcome" value="pay"><button type="submit">Pay</button></form>
<form method="post"><input type="hidden" name="outcome" value="fail"><button type="submit">Fail the payment</button></form>`
    );
    return { status: 200, page };
  }

  /** The dummy page's buttons: a signed webhook through the same path a real provider's takes. */
  async dummyComplete(providerRef: string, outcome: unknown): Promise<PayTarget> {
    const session = await this.dummySession(providerRef);
    if (outcome !== 'pay' && outcome !== 'fail') throw new BadRequestException('outcome must be pay or fail');
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
    if (after.status === 'paid' && after.returnUrl) return { redirect: after.returnUrl };
    return after.status === 'paid'
      ? { status: 200, page: simplePage('Payment received', '<p>Thank you. You can close this window.</p>') }
      : this.payTarget(after.id);
  }

  private async dummySession(providerRef: string) {
    if (paymentProvider().name !== 'dummy') throw new NotFoundException();
    const session = await this.prisma.session.findUnique({ where: { provider_providerRef: { provider: 'dummy', providerRef } } });
    if (!session) throw new NotFoundException();
    return session;
  }
}
