import { Injectable, Logger, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { schemaUrl } from './database-urls';
import type { ActiveBusiness } from './tenant-context';

const positive = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

type Entry = { client: PrismaClient; active: number };

/** How long a request waits for a client to come free when all are busy, before giving up. */
const WAIT_FOR_CLIENT_MS = 15_000;

/**
 * One Prisma client per business schema, kept for the businesses used most recently. Each
 * holds a small pool (TENANT_CONNECTION_LIMIT, default 3), so at most TENANT_CLIENT_CACHE ×
 * TENANT_CONNECTION_LIMIT connections are open; at scale put PgBouncer (transaction mode,
 * `pgbouncer=true` in the URL) in front of PostgreSQL (README, "Hosting the online server").
 *
 * Requests acquire their business's client and release it when they finish. Only idle clients
 * are dropped (least recently used first), so a sale is never cut off mid-transaction; when the
 * cache is full and every client is busy, a request for another business waits for one to come
 * free rather than open more connections than the database allows.
 */
@Injectable()
export class TenantClients implements OnModuleDestroy {
  private readonly clients = new Map<string, Entry>();
  private readonly maxClients = positive(process.env.TENANT_CLIENT_CACHE, 100);
  private readonly connectionLimit = positive(process.env.TENANT_CONNECTION_LIMIT, 3);
  private readonly waiting: Array<() => void> = [];
  private readonly logger = new Logger(TenantClients.name);

  constructor() {
    const most = this.maxClients * this.connectionLimit;
    const viaPgBouncer = /[?&]pgbouncer=true\b/.test(process.env.DATABASE_URL ?? '');
    if (most > 90 && !viaPgBouncer) {
      this.logger.warn(
        `Up to ${most} database connections (TENANT_CLIENT_CACHE ${this.maxClients} × TENANT_CONNECTION_LIMIT ${this.connectionLimit}): ` +
          "more than PostgreSQL's default max_connections of 100. Use PgBouncer or lower them."
      );
    }
  }

  /**
   * The business's client, held until `release` is called (once; later calls do nothing). Use
   * for anything that may run while other businesses come and go: a request, an import.
   */
  async acquire(business: Pick<ActiveBusiness, 'schemaName' | 'dbServer'>) {
    const key = `${business.dbServer}/${business.schemaName}`;
    const deadline = Date.now() + WAIT_FOR_CLIENT_MS;
    let entry = this.clients.get(key);
    while (!entry) {
      if (this.clients.size < this.maxClients || this.dropLeastRecentIdle()) {
        entry = { client: new PrismaClient({ datasourceUrl: schemaUrl(business.schemaName, business.dbServer, this.connectionLimit) }), active: 0 };
        break;
      }
      // Every client is busy: wait for one to come free, then look again.
      const left = deadline - Date.now();
      if (left <= 0) throw new ServiceUnavailableException('The server is busy. Try again in a moment.');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, left);
        function done() {
          clearTimeout(timer);
          resolve();
        }
        this.waiting.push(done);
      });
      entry = this.clients.get(key);
    }
    // Most recently used goes last, so the first idle entry is the one to drop.
    this.clients.delete(key);
    this.clients.set(key, entry);
    entry.active += 1;
    const held = entry;
    let released = false;
    return {
      client: held.client,
      release: () => {
        if (released) return;
        released = true;
        held.active -= 1;
        if (held.active === 0) this.waiting.shift()?.();
      }
    };
  }

  /** How many clients are kept, and how many are in use (for tests and health checks). */
  stats() {
    const entries = [...this.clients.values()];
    return { clients: entries.length, inUse: entries.filter((entry) => entry.active > 0).length, waiting: this.waiting.length };
  }

  /** Drops the least recently used idle client; false when every client is busy. */
  private dropLeastRecentIdle() {
    for (const [key, entry] of this.clients) {
      if (entry.active > 0) continue;
      this.clients.delete(key);
      this.disconnect(entry.client);
      return true;
    }
    return false;
  }

  /** Disconnects in the background; a client that never connected may fail to, which doesn't matter. */
  private disconnect(client: PrismaClient) {
    client.$disconnect().catch((error: unknown) => this.logger.warn(`Couldn't disconnect a business client: ${String(error)}`));
  }

  async onModuleDestroy() {
    await Promise.all([...this.clients.values()].map((entry) => entry.client.$disconnect().catch(() => undefined)));
    this.clients.clear();
  }
}
