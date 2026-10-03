import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
  addBillingPeriod,
  billingStateAt,
  planByCode,
  PLANS,
  subscriptionGst,
  TRIAL_PLAN,
  type BillingPeriod,
  type BillingStatus,
  type BillingSummary,
  type PlanCode
} from '@pos/contracts';
import { isManagedHosting } from '../common/mode';
import { requireAdmin } from '../common/request-session';
import type { SessionUser } from '../common/types';
import { Mailer } from '../mail/mailer';
import { PrismaService } from '../prisma.service';
import { currentBusiness, type ActiveBusiness, type BusinessBilling } from '../tenancy/tenant-context';
import { TenancyService } from '../tenancy/tenancy.service';
import { DummyGateway } from './dummy-gateway';
import { billingEnforced, paymentGateway } from './gateways';
import {
  fiscalYearOf,
  invoiceNumber,
  invoiceText,
  periodLabel,
  renderInvoiceHtml,
  splitSubscriptionGst,
  subscriptionGstRate,
  type InvoiceRecord
} from './invoice';
import { InvalidWebhookError, type GatewayEvent } from './payment-gateway';

const iso = (date: Date | null) => (date ? date.toISOString() : null);
const latest = (...dates: Array<Date | null>) => new Date(Math.max(...dates.filter((d): d is Date => d !== null).map((d) => d.getTime())));

/** The plan a business's limits come from; one no longer offered counts as the trial plan. */
export const planOf = (billing: BusinessBilling) => planByCode(billing.plan) ?? planByCode(TRIAL_PLAN)!;

/**
 * The time a payment buys. Paid time starts when the trial or the time already paid ends. A
 * different plan starts at once: paid time left on the old plan is carried over, worth the
 * same money at the new plan's price.
 */
export function paidPeriod(
  business: { plan: string; trialEndsAt: Date | null; paidUntil: Date | null },
  plan: PlanCode,
  period: BillingPeriod,
  now: Date
) {
  const base = latest(now, business.trialEndsAt);
  let periodFrom: Date;
  if (plan === business.plan) {
    periodFrom = latest(base, business.paidUntil);
  } else {
    const left = business.paidUntil ? Math.max(0, business.paidUntil.getTime() - base.getTime()) : 0;
    const from = planByCode(business.plan);
    const to = planByCode(plan)!;
    const carried = from ? Math.round((left * from.prices.month) / to.prices.month) : 0;
    periodFrom = new Date(base.getTime() + carried);
  }
  return { periodFrom, periodTo: addBillingPeriod(periodFrom, period) };
}

export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** A page for the payer's browser: the dummy gateway's, and the answers of /billing/pay. `body` is HTML. */
export function simplePage(title: string, body: string) {
  const escape = escapeHtml;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title>
<style>body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f8fafc;color:#0f172a;margin:0;padding:48px 16px}
.card{max-width:440px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px}
h1{font-size:20px;margin:0 0 12px}p{color:#475569;line-height:1.5}
button{font:inherit;font-weight:600;border:0;border-radius:8px;padding:10px 16px;cursor:pointer;margin-right:8px}
.pay{background:#2563eb;color:#fff}.fail{background:#e2e8f0;color:#0f172a}
.note{background:#fef3c7;color:#92400e;border-radius:8px;padding:8px 12px;font-size:14px}</style></head>
<body><div class="card"><h1>${escape(title)}</h1>${body}</div></body></html>`;
}

/** What /billing/pay says about a payment that is no longer waiting. */
const settledPage = (status: string) =>
  status === 'PAID'
    ? simplePage('Already paid', '<p>This payment has been made. You can close this window and go back to the app.</p>')
    : simplePage("This payment didn't go through", '<p>Start it again from the app, under Settings → Billing.</p>');

/**
 * Subscriptions on managed hosting: what a business is on, starting payments, and settling them
 * from the gateway's webhooks. Payments only ever count from a verified webhook, never from the
 * app saying so.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger('Billing');

  constructor(
    private readonly tenancy: TenancyService,
    private readonly prisma: PrismaService,
    private readonly mailer: Mailer
  ) {}

  /** The signed-in request's business, with its billing (set by the sign-in check). */
  private requestBusiness() {
    const business = currentBusiness();
    if (!business?.billing) throw new NotFoundException();
    return business as ActiveBusiness & { billing: BusinessBilling };
  }

  status(): BillingStatus {
    const { billing } = this.requestBusiness();
    const { state, endsAt, graceEndsAt } = billingStateAt(billing);
    return { enforced: billingEnforced(), state, plan: planOf(billing).code, endsAt: iso(endsAt), graceEndsAt: iso(graceEndsAt) };
  }

  async summary(session: SessionUser): Promise<BillingSummary> {
    requireAdmin(session);
    const business = this.requestBusiness();
    const gateway = paymentGateway();
    const gstRate = subscriptionGstRate();
    const [branches, counters, invoices] = await Promise.all([
      this.prisma.branch.count(),
      this.prisma.counter.count({ where: { isActive: true } }),
      this.tenancy.control.billingInvoice.findMany({
        where: { businessId: business.id },
        orderBy: { issuedAt: 'desc' },
        take: 24,
        select: { id: true, number: true, issuedAt: true, plan: true, period: true, total: true }
      })
    ]);
    const price = (amount: number) => {
      const gst = subscriptionGst(amount, gstRate);
      return { amount, gst, total: amount + gst };
    };
    return {
      ...this.status(),
      trialEndsAt: iso(business.billing.trialEndsAt),
      paidUntil: iso(business.billing.paidUntil),
      paymentsEnabled: billingEnforced(),
      gateway: gateway?.name ?? null,
      gatewayNote: gateway?.note ?? null,
      gstRate,
      usage: { branches, counters },
      plans: PLANS.map((plan) => ({
        code: plan.code,
        name: plan.name,
        branches: plan.branches,
        counters: plan.counters,
        prices: { month: price(plan.prices.month), year: price(plan.prices.year) }
      })),
      invoices: invoices.map((invoice) => ({
        id: invoice.id,
        number: invoice.number,
        issuedAt: invoice.issuedAt.toISOString(),
        plan: planByCode(invoice.plan)?.code ?? TRIAL_PLAN,
        period: invoice.period === 'year' ? 'year' : 'month',
        total: invoice.total
      }))
    };
  }

  /** Admins: a payment for a plan, started with the gateway. The app then opens payPath. */
  async checkout(session: SessionUser, input: { plan: PlanCode; period: BillingPeriod }) {
    requireAdmin(session);
    const gateway = paymentGateway();
    if (!billingEnforced() || !gateway) throw new ServiceUnavailableException("Payments aren't set up on this server.");
    const business = this.requestBusiness();
    const plan = planByCode(input.plan);
    if (!plan) throw new BadRequestException('Unknown plan');
    const amount = plan.prices[input.period];
    const gst = subscriptionGst(amount, subscriptionGstRate());
    const control = this.tenancy.control;
    const checkout = await control.billingCheckout.create({
      data: { businessId: business.id, plan: plan.code, period: input.period, amount, gst, total: amount + gst, gateway: gateway.name },
      select: { id: true, total: true }
    });
    try {
      const started = await gateway.createCheckout({
        checkoutId: checkout.id,
        amount: checkout.total,
        currency: 'INR',
        description: `Point of Sale, ${plan.name} plan, ${periodLabel(input.period)}`,
        businessCode: business.code,
        customerEmail: (await this.ownerEmails(business.id))[0] ?? null
      });
      await control.billingCheckout.update({
        where: { id: checkout.id },
        data: { gatewayRef: started.gatewayRef, redirectUrl: started.redirectUrl }
      });
    } catch (error) {
      this.logger.error(`Starting a ${gateway.name} payment for ${business.code} failed: ${error instanceof Error ? error.message : String(error)}`);
      await control.billingCheckout.update({ where: { id: checkout.id }, data: { status: 'FAILED', settledAt: new Date() } });
      throw new ServiceUnavailableException("The payment couldn't be started. Try again in a few minutes.");
    }
    return { checkoutId: checkout.id, payPath: `/billing/pay/${checkout.id}` };
  }

  /** /billing/pay/<id>, opened in the payer's browser: on to the gateway, or why not. */
  async payTarget(checkoutId: string): Promise<{ redirect: string } | { page: string }> {
    const checkout = /^[0-9a-f-]{36}$/i.test(checkoutId)
      ? await this.tenancy.control.billingCheckout.findUnique({ where: { id: checkoutId }, select: { status: true, redirectUrl: true } })
      : null;
    if (!checkout) return { page: simplePage('Payment link not found', '<p>Start the payment again from the app, under Settings → Billing.</p>') };
    if (checkout.status !== 'PENDING' || !checkout.redirectUrl) return { page: settledPage(checkout.redirectUrl ? checkout.status : 'FAILED') };
    return { redirect: checkout.redirectUrl };
  }

  /** The dummy gateway's checkout: the payment it stands for, while BILLING_GATEWAY=dummy. */
  private async dummyCheckout(gatewayRef: string) {
    const gateway = paymentGateway();
    if (!isManagedHosting() || !(gateway instanceof DummyGateway)) throw new NotFoundException();
    const checkout = await this.tenancy.control.billingCheckout.findUnique({
      where: { gateway_gatewayRef: { gateway: gateway.name, gatewayRef } },
      select: { plan: true, period: true, total: true, status: true, business: { select: { name: true } } }
    });
    if (!checkout) throw new NotFoundException();
    return { gateway, checkout };
  }

  async dummyPage(gatewayRef: string) {
    const { checkout } = await this.dummyCheckout(gatewayRef);
    if (checkout.status !== 'PENDING') return settledPage(checkout.status);
    const plan = planByCode(checkout.plan)?.name ?? checkout.plan;
    const amount = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(checkout.total / 100);
    return simplePage(
      `Pay ${amount}`,
      `<p class="note">Test gateway: no money is taken. Choose what the payment does.</p>
<p>${escapeHtml(`${checkout.business.name}: ${plan} plan, ${periodLabel(checkout.period)}.`)}</p>
<form method="post"><button class="pay" name="outcome" value="paid">Pay ${amount}</button><button class="fail" name="outcome" value="failed">Fail the payment</button></form>`
    );
  }

  /** A button on the dummy page: the gateway "sends" its signed webhook, handled as any other. */
  async dummyComplete(gatewayRef: string, outcome: unknown) {
    const { gateway, checkout } = await this.dummyCheckout(gatewayRef);
    const paid = outcome === 'paid';
    const webhook = gateway.webhookFor({
      type: paid ? 'payment.succeeded' : 'payment.failed',
      gatewayRef,
      amount: checkout.total,
      reason: paid ? undefined : 'Declined (test)'
    });
    await this.receiveWebhook(gateway.name, webhook.body, webhook.headers);
    return paid
      ? simplePage('Payment received', '<p>Thank you. You can close this window and go back to the app.</p>')
      : simplePage("The payment didn't go through", '<p>Nothing was charged. Go back to the app to try again.</p>');
  }

  /** POST /billing/webhooks/<gateway>: only the gateway in use, and only with its signature. */
  async receiveWebhook(gatewayName: string, rawBody: Buffer | undefined, headers: Record<string, string | string[] | undefined>) {
    const gateway = paymentGateway();
    if (!isManagedHosting() || !gateway || gateway.name !== gatewayName) throw new NotFoundException();
    let events: GatewayEvent[];
    try {
      events = gateway.parseWebhook(rawBody ?? Buffer.alloc(0), headers);
    } catch (error) {
      if (error instanceof InvalidWebhookError) {
        this.logger.warn(`Refused a ${gatewayName} webhook: ${error.message}`);
        throw new BadRequestException('Invalid webhook');
      }
      throw error;
    }
    for (const event of events) await this.applyEvent(gateway.name, event);
    return { received: events.length };
  }

  /**
   * One gateway event, at most once: a retried delivery finds its event recorded and changes
   * nothing. A payment counts only for the checkout's full amount.
   */
  async applyEvent(gatewayName: string, event: GatewayEvent) {
    const control = this.tenancy.control;
    const checkout = await control.billingCheckout.findUnique({
      where: { gateway_gatewayRef: { gateway: gatewayName, gatewayRef: event.gatewayRef } },
      select: {
        id: true,
        plan: true,
        period: true,
        amount: true,
        gst: true,
        total: true,
        business: { select: { id: true, code: true, name: true, schemaName: true, dbServer: true } }
      }
    });
    if (!checkout) {
      this.logger.warn(`A ${gatewayName} event for an unknown payment (${event.gatewayRef}) was ignored`);
      return;
    }
    const business = checkout.business;
    const buyer = event.type === 'payment.succeeded' ? await this.buyerOf(business) : null;

    const outcome = await control.$transaction(async (tx) => {
      const recorded = await tx.billingEvent.createMany({ data: [{ gateway: gatewayName, eventId: event.eventId }], skipDuplicates: true });
      if (recorded.count === 0) return null;
      const [current] = await tx.$queryRaw<Array<{ status: string }>>`SELECT status FROM "BillingCheckout" WHERE id = ${checkout.id} FOR UPDATE`;
      if (current?.status !== 'PENDING') return null;
      const now = new Date();
      const counts = event.type === 'payment.succeeded' && event.amount === checkout.total;
      if (!counts) {
        if (event.type === 'payment.succeeded') {
          this.logger.error(`Payment ${event.gatewayRef} for ${business.code} was ${event.amount}, not ${checkout.total}; not counted`);
        }
        await tx.billingCheckout.update({ where: { id: checkout.id }, data: { status: 'FAILED', settledAt: now } });
        return { paid: false as const, reason: event.reason ?? null };
      }

      const [locked] = await tx.$queryRaw<Array<{ plan: string; trialEndsAt: Date | null; paidUntil: Date | null }>>`
        SELECT plan, "trialEndsAt", "paidUntil" FROM "Business" WHERE id = ${business.id} FOR UPDATE`;
      const plan = planByCode(checkout.plan)!.code;
      const period: BillingPeriod = checkout.period === 'year' ? 'year' : 'month';
      const { periodFrom, periodTo } = paidPeriod(locked, plan, period, now);
      await tx.business.update({ where: { id: business.id }, data: { plan, paidUntil: periodTo, billingNotice: null } });
      await tx.billingCheckout.update({ where: { id: checkout.id }, data: { status: 'PAID', settledAt: now } });

      const fiscalYear = fiscalYearOf(now);
      const [{ last }] = await tx.$queryRaw<Array<{ last: number }>>`
        INSERT INTO "BillingInvoiceSequence" ("fiscalYear", "last") VALUES (${fiscalYear}, 1)
        ON CONFLICT ("fiscalYear") DO UPDATE SET "last" = "BillingInvoiceSequence"."last" + 1
        RETURNING "last"`;
      const invoice: InvoiceRecord = {
        number: invoiceNumber(fiscalYear, last),
        issuedAt: now,
        buyerName: buyer!.name,
        buyerGstin: buyer!.gstin,
        buyerState: buyer!.state,
        plan,
        period,
        periodFrom,
        periodTo,
        amount: checkout.amount,
        ...splitSubscriptionGst(checkout.gst, buyer!.state),
        total: checkout.total
      };
      await tx.billingInvoice.create({ data: { ...invoice, businessId: business.id, checkoutId: checkout.id } });
      return { paid: true as const, invoice };
    });
    if (!outcome) return;

    this.tenancy.forget(business.id);
    const owners = await this.ownerEmails(business.id);
    for (const to of owners) {
      await this.mailer.sendNotice(
        outcome.paid
          ? {
              to,
              subject: `Payment received: ${business.name} is paid until ${outcome.invoice.periodTo.toLocaleDateString('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' })}`,
              text: `Thank you. Your ${outcome.invoice.number} is below; it is also in the app under Settings → Billing.\n\n${invoiceText(outcome.invoice)}`,
              html: renderInvoiceHtml(outcome.invoice)
            }
          : {
              to,
              subject: `A payment for ${business.name} didn't go through`,
              text: [
                `A payment for ${business.name}'s Point of Sale subscription didn't go through${outcome.reason ? ` (${outcome.reason})` : ''}.`,
                'Nothing was charged. An admin can try again under Settings → Billing.'
              ].join('\n')
            }
      );
    }
  }

  /** Admins: one of the business's invoices, as a printable page. */
  async invoice(session: SessionUser, id: string) {
    requireAdmin(session);
    const business = this.requestBusiness();
    const invoice = await this.tenancy.control.billingInvoice.findFirst({ where: { id, businessId: business.id } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return { number: invoice.number, html: renderInvoiceHtml(invoice) };
  }

  /** The buyer on our invoice: the business's name and GSTIN, its state from the GSTIN or a branch. */
  private buyerOf(business: ActiveBusiness) {
    return this.tenancy.run(business, async () => {
      const settings = await this.prisma.businessSettings.findUnique({ where: { id: 'default' }, select: { name: true, gstNumber: true } });
      const gstin = settings?.gstNumber?.trim().toUpperCase() || null;
      const branch = gstin
        ? null
        : await this.prisma.branch.findFirst({ where: { stateCode: { not: null } }, orderBy: { code: 'asc' }, select: { stateCode: true } });
      return { name: settings?.name || business.name, gstin, state: gstin ? gstin.slice(0, 2) : (branch?.stateCode ?? null) };
    });
  }

  async ownerEmails(businessId: string) {
    const memberships = await this.tenancy.control.membership.findMany({
      where: { businessId },
      orderBy: { createdAt: 'asc' },
      select: { account: { select: { email: true } } }
    });
    return memberships.map((membership) => membership.account.email);
  }
}
