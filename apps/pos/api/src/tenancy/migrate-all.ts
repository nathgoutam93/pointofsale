import { PrismaClient as ControlClient } from '.prisma/control-client';
import { controlDatabaseUrl, schemaUrl } from './database-urls';
import { businessSchemaFile, controlSchemaFile, latestBusinessMigration, migrateDeploy } from './migrator';

export type MigrationResult = { code: string; schemaName: string; ok: boolean; error?: string };

/**
 * The deploy step of the hosted server: the control schema first, then every business's
 * schema, a few at a time. Stops starting new ones after the first failure (the rest stay
 * at their old version and keep working, since migrations are written expand-then-contract),
 * and records each business's version.
 */
export async function migrateAllBusinesses(options: { concurrency?: number; log?: (line: string) => void } = {}) {
  const log = options.log ?? (() => undefined);
  const concurrency = Math.max(1, options.concurrency ?? 4);
  await migrateDeploy(controlSchemaFile(), { CONTROL_DATABASE_URL: controlDatabaseUrl() });
  log('Control schema is up to date');

  const control = new ControlClient({ datasourceUrl: controlDatabaseUrl() });
  const latest = latestBusinessMigration();
  const results: MigrationResult[] = [];
  try {
    const businesses = await control.business.findMany({
      where: { status: { in: ['ACTIVE', 'SUSPENDED'] } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, code: true, schemaName: true, dbServer: true }
    });
    let next = 0;
    let failed = false;
    const worker = async () => {
      while (!failed && next < businesses.length) {
        const business = businesses[next++];
        try {
          await migrateDeploy(businessSchemaFile(), { DATABASE_URL: schemaUrl(business.schemaName, business.dbServer) });
          await control.business.update({ where: { id: business.id }, data: { schemaVersion: latest } });
          results.push({ code: business.code, schemaName: business.schemaName, ok: true });
          log(`${business.code}: up to date`);
        } catch (error) {
          failed = true;
          const message = error instanceof Error ? error.message : String(error);
          results.push({ code: business.code, schemaName: business.schemaName, ok: false, error: message });
          log(`${business.code}: FAILED ${message}`);
        }
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    return { latest, results, ok: !failed, skipped: businesses.length - results.length };
  } finally {
    await control.$disconnect();
  }
}
