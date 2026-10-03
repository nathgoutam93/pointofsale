import { BadRequestException, Injectable, OnModuleDestroy, UnauthorizedException } from '@nestjs/common';
import { PrismaClient as ControlClient } from '.prisma/control-client';
import { controlDatabaseUrl } from './database-urls';
import { TenantClients } from './tenant-clients';
import { enterBusiness, runForBusiness, type ActiveBusiness } from './tenant-context';

/** How long a business's details are trusted before the control schema is asked again. */
const CACHE_MS = 30_000;

const businessSelect = {
  id: true,
  code: true,
  name: true,
  schemaName: true,
  dbServer: true,
  status: true,
  plan: true,
  trialEndsAt: true,
  paidUntil: true
} as const;

/**
 * The hosted server's businesses: finds a request's business and points the request at its
 * schema. Only used online; offline installs have one business and no control schema.
 */
@Injectable()
export class TenancyService implements OnModuleDestroy {
  private controlClient: ControlClient | null = null;
  private readonly cache = new Map<string, { business: ActiveBusiness & { status: string }; at: number }>();

  constructor(private readonly clients: TenantClients) {}

  /** The control schema (businesses, owner accounts), connected on first use. */
  get control() {
    this.controlClient ??= new ControlClient({ datasourceUrl: controlDatabaseUrl() });
    return this.controlClient;
  }

  private async load(id: string) {
    const cached = this.cache.get(id);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.business;
    const found = await this.control.business.findUnique({ where: { id }, select: businessSelect });
    if (!found) return null;
    const { plan, trialEndsAt, paidUntil, ...rest } = found;
    const business = { ...rest, billing: { plan, trialEndsAt, paidUntil } };
    this.cache.set(id, { business, at: Date.now() });
    return business;
  }

  /** Forget a business's cached details, e.g. after it is suspended or pays. */
  forget(id: string) {
    this.cache.delete(id);
  }

  /** Signed-in requests: the business named in the token. */
  async enterById(id: string) {
    const business = await this.load(id);
    if (!business) throw new UnauthorizedException('Session is no longer valid, please sign in again');
    if (business.status !== 'ACTIVE') throw new UnauthorizedException('This business is not active');
    enterBusiness(business, this.clients.clientFor(business));
    return business;
  }

  /** Sign-in: the business code the person typed. */
  async enterByCode(code: string | undefined) {
    if (!code) throw new BadRequestException('Enter your business code');
    const found = await this.control.business.findUnique({ where: { code: code.trim().toUpperCase() }, select: { id: true } });
    if (!found) throw new BadRequestException('Unknown business code');
    return this.enterById(found.id).catch((error) => {
      throw error instanceof UnauthorizedException ? new BadRequestException(error.message) : error;
    });
  }

  /** Runs `work` against a business's schema, outside a request (provisioning, scripts, tests). */
  run<T>(business: ActiveBusiness, work: () => Promise<T>) {
    return runForBusiness(business, this.clients.clientFor(business), work);
  }

  async onModuleDestroy() {
    await this.controlClient?.$disconnect();
  }
}
