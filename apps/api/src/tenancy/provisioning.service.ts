import { Injectable, Logger } from '@nestjs/common';
import { Prisma as ControlPrisma } from '.prisma/control-client';
import { randomInt, randomUUID } from 'crypto';
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
 * Creates a business on the hosted server: a row in the control schema, its own PostgreSQL
 * schema at the current migration, and its first branch, counter and admin (the same setup
 * an offline install runs). Anything failing on the way removes the schema again.
 */
@Injectable()
export class ProvisioningService {
  private readonly logger = new Logger(ProvisioningService.name);

  constructor(
    private readonly tenancy: TenancyService,
    private readonly setup: SetupService
  ) {}

  /** Reserves a code and a schema name. `code` is for tests and imports; normally random. */
  private async reserve(name: string, code?: string) {
    for (let attempt = 0; ; attempt += 1) {
      const id = randomUUID();
      try {
        return await this.tenancy.control.business.create({
          data: { id, code: code ?? newCode(), name, schemaName: `b_${id.replace(/-/g, '')}` },
          select: { id: true, code: true, name: true, schemaName: true, dbServer: true }
        });
      } catch (error) {
        const clash = error instanceof ControlPrisma.PrismaClientKnownRequestError && error.code === 'P2002';
        if (!clash || code || attempt >= 5) throw error;
      }
    }
  }

  async createBusiness(input: SetupInput, options: { code?: string; accountId?: string } = {}) {
    const business: ActiveBusiness = await this.reserve(input.businessName, options.code);
    const control = this.tenancy.control;
    // Schema names are generated here (b_ + hex), never taken from a request.
    const schema = `"${business.schemaName}"`;
    try {
      await control.$executeRawUnsafe(`CREATE SCHEMA ${schema}`);
      await migrateDeploy(businessSchemaFile(), { DATABASE_URL: schemaUrl(business.schemaName, business.dbServer) });
      const session = await this.tenancy.run(business, () => this.setup.setup(input));
      await control.business.update({
        where: { id: business.id },
        data: {
          status: 'ACTIVE',
          schemaVersion: latestBusinessMigration(),
          ...(options.accountId ? { memberships: { create: { accountId: options.accountId } } } : {})
        }
      });
      this.logger.log(`Created business ${business.code} (${business.schemaName})`);
      return { business: { id: business.id, code: business.code, name: business.name, status: 'ACTIVE' as const }, session };
    } catch (error) {
      this.logger.error(`Creating business ${business.code} failed: ${error instanceof Error ? error.message : String(error)}`);
      await control.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
      await control.business.update({ where: { id: business.id }, data: { status: 'FAILED' } }).catch(() => undefined);
      throw error;
    }
  }
}
