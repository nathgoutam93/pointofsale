import { Injectable, Logger } from '@nestjs/common';
import { Prisma as ControlPrisma } from '.prisma/control-client';
import { randomInt, randomUUID } from 'crypto';
import { TRIAL_DAYS, TRIAL_PLAN } from '@pos/contracts';
import { SetupInput, SetupService } from '../setup/setup.service';
import { schemaUrl } from './database-urls';
import { businessSchemaFile, latestBusinessMigration, migrateDeploy } from './migrator';
import type { ActiveBusiness } from './tenant-context';
import { TenancyService } from './tenancy.service';

/** No 0/O, 1/I/L: codes are read out and typed by hand. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

const newCode = () => Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

/**
 * Creates businesses on the hosted server: a row in the control schema and the business's
 * own PostgreSQL schema at the current migration. A new business then gets its first branch,
 * counter and admin (the same setup an offline install runs); a business moving online gets
 * its data instead (see ImportService). Anything failing on the way removes the schema again.
 */
@Injectable()
export class ProvisioningService {
  private readonly logger = new Logger(ProvisioningService.name);

  constructor(
    private readonly tenancy: TenancyService,
    private readonly setup: SetupService
  ) {}

  /** Reserves a code and a schema name. `code` is for tests and scripts; normally random. */
  async reserve(name: string, options: { code?: string; importId?: string } = {}): Promise<ActiveBusiness> {
    for (let attempt = 0; ; attempt += 1) {
      const id = randomUUID();
      try {
        return await this.tenancy.control.business.create({
          data: { id, code: options.code ?? newCode(), name, schemaName: `b_${id.replace(/-/g, '')}`, importId: options.importId },
          select: { id: true, code: true, name: true, schemaName: true, dbServer: true }
        });
      } catch (error) {
        const clash = error instanceof ControlPrisma.PrismaClientKnownRequestError && error.code === 'P2002';
        if (!clash || options.code || options.importId || attempt >= 5) throw error;
      }
    }
  }

  /** The business's schema, migrated to this version. Schema names are generated (b_ + hex), never from a request. */
  async createSchema(business: ActiveBusiness) {
    await this.tenancy.control.$executeRawUnsafe(`CREATE SCHEMA "${business.schemaName}"`);
    await migrateDeploy(businessSchemaFile(), { DATABASE_URL: schemaUrl(business.schemaName, business.dbServer) });
  }

  /** Ready for use, on a free trial (managed hosting charges after it); `accountId` becomes its owner. */
  async activate(business: ActiveBusiness, accountId?: string) {
    await this.tenancy.control.business.update({
      where: { id: business.id },
      data: {
        status: 'ACTIVE',
        schemaVersion: latestBusinessMigration(),
        plan: TRIAL_PLAN,
        trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
        ...(accountId ? { memberships: { create: { accountId } } } : {})
      }
    });
    this.tenancy.forget(business.id);
    this.logger.log(`Business ${business.code} is ready (${business.schemaName})`);
  }

  /** After a failure: the schema is dropped and the business marked FAILED. */
  async discard(business: ActiveBusiness, error: unknown) {
    this.logger.error(`Creating business ${business.code} failed: ${error instanceof Error ? error.message : String(error)}`);
    await this.tenancy.control.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${business.schemaName}" CASCADE`).catch(() => undefined);
    await this.tenancy.control.business.update({ where: { id: business.id }, data: { status: 'FAILED' } }).catch(() => undefined);
  }

  /** A new, empty business with its first admin signed in. */
  async createBusiness(input: SetupInput, options: { code?: string; accountId?: string } = {}) {
    const business = await this.reserve(input.businessName, { code: options.code });
    try {
      await this.createSchema(business);
      const session = await this.tenancy.run(business, () => this.setup.setup(input));
      await this.activate(business, options.accountId);
      return { business: { id: business.id, code: business.code, name: business.name, status: 'ACTIVE' as const }, session };
    } catch (error) {
      await this.discard(business, error);
      throw error;
    }
  }
}
