import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { schemaUrl } from './database-urls';
import type { ActiveBusiness } from './tenant-context';

const positive = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

/**
 * One Prisma client per business schema, kept for the businesses used most recently. Each
 * holds a small pool (TENANT_CONNECTION_LIMIT, default 3), so many businesses don't exhaust
 * the server's connections; put PgBouncer (transaction mode, `pgbouncer=true` in the URL)
 * in front of PostgreSQL at scale.
 */
@Injectable()
export class TenantClients implements OnModuleDestroy {
  private readonly clients = new Map<string, PrismaClient>();
  private readonly maxClients = positive(process.env.TENANT_CLIENT_CACHE, 100);
  private readonly connectionLimit = positive(process.env.TENANT_CONNECTION_LIMIT, 3);

  clientFor(business: Pick<ActiveBusiness, 'schemaName' | 'dbServer'>) {
    const key = `${business.dbServer}/${business.schemaName}`;
    const existing = this.clients.get(key);
    if (existing) {
      // Most recently used goes last, so the first entry is the one to drop.
      this.clients.delete(key);
      this.clients.set(key, existing);
      return existing;
    }
    const client = new PrismaClient({ datasourceUrl: schemaUrl(business.schemaName, business.dbServer, this.connectionLimit) });
    this.clients.set(key, client);
    if (this.clients.size > this.maxClients) {
      const [oldestKey, oldest] = this.clients.entries().next().value as [string, PrismaClient];
      this.clients.delete(oldestKey);
      // Prisma reconnects by itself if a request still holding it makes another query.
      void oldest.$disconnect();
    }
    return client;
  }

  async onModuleDestroy() {
    await Promise.all([...this.clients.values()].map((client) => client.$disconnect()));
    this.clients.clear();
  }
}
