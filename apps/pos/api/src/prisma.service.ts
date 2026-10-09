import { PrismaClient } from '@prisma/client';
import { isOffline } from './common/mode';
import { currentTenantClient } from './tenancy/tenant-context';

/**
 * What every service injects to reach the business's data. It is a stand-in that hands each
 * call to the right client:
 * - offline (one business on this computer): always the single local database;
 * - online (the hosted server): the schema of the business the current request is for
 *   (set by AuthGuard or sign-in). With no business chosen it throws, and never falls back
 *   to another business's data.
 */
export abstract class PrismaService extends PrismaClient {}

/** Read by Nest and by `await` on any provider; must not demand a business. */
const PASSIVE_KEYS = new Set<PropertyKey>([
  'then',
  'onModuleInit',
  'onApplicationBootstrap',
  'onModuleDestroy',
  'beforeApplicationShutdown',
  'onApplicationShutdown'
]);

export async function createPrismaService(): Promise<PrismaService> {
  const local = isOffline() ? new PrismaClient() : null;
  // Fail at startup, not on the first sale, if the local database is unreachable.
  await local?.$connect();
  return new Proxy(Object.create(null) as PrismaService, {
    get(_target, key) {
      const client = currentTenantClient() ?? local;
      if (!client) {
        if (PASSIVE_KEYS.has(key) || typeof key === 'symbol') return undefined;
        throw new Error(`No business chosen for this database call (${String(key)})`);
      }
      const value = Reflect.get(client, key, client);
      return typeof value === 'function' ? value.bind(client) : value;
    }
  });
}
