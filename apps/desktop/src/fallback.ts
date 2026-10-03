import { app, net } from 'electron';
import { createWriteStream } from 'fs';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { baseEnv, LocalApi, runMigrations, runScript } from './api-server.js';
import type { Logger } from './log.js';
import { paths } from './paths.js';
import { describe, LocalPostgres } from './postgres.js';
import { APP_ORIGIN } from './protocol.js';

/**
 * This computer as its branch's fallback counter (Phase 7 of desktop-offline-online-plan.md):
 * the counter it sells on, the key the server gave it, and the local copy's own secrets.
 */
export type FallbackSettings = {
  counterId: string;
  counterName: string;
  branchId: string;
  /** The online server it belongs to. */
  server: string;
  /** From the server: fetches the local copy and sends the offline sales. */
  key: string;
  /** The local API's: reading the offline sales (outbox), its token signing key, its database password. */
  localSecret: string;
  authSecret: string;
  dbPassword: string;
  /** When the local copy last matched the server; null until the first copy. */
  refreshedAt: string | null;
  /** Selling from the local copy right now. */
  active: boolean;
  /** Sales made offline not yet on the server: the local copy must not be replaced. */
  pendingSync: boolean;
  /**
   * The last invoice number seen issued online, per series and year ("MAI/1/26" → 2): the
   * copy may be older than the last sale, so offline invoices carry on after these.
   */
  issued?: Record<string, number>;
};

/** What the screens show about it. */
export type FallbackStatus = {
  configured: boolean;
  counterId: string | null;
  counterName: string | null;
  ready: boolean;
  refreshedAt: string | null;
  active: boolean;
  pendingSync: boolean;
  syncing: boolean;
  /** null: not known yet. */
  serverReachable: boolean | null;
  error: string | null;
};

const FALLBACK_KEY_HEADER = 'x-pos-fallback-key';
const FALLBACK_SECRET_HEADER = 'x-pos-fallback-secret';

/** The error message the server or the local API sent, or `fallback`. */
async function failure(res: Response, fallback: string) {
  const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
  const message = Array.isArray(body?.message) ? body.message.join(', ') : body?.message;
  return typeof message === 'string' ? message : `${fallback} (${res.status})`;
}

/**
 * The fallback counter's local copy: its own embedded PostgreSQL and the API in fallback mode
 * (POS_FALLBACK=1), kept running and refreshed from the server while online, so it is ready
 * the moment the server can't be reached.
 */
export class FallbackCounter {
  private postgres: LocalPostgres | null = null;
  private api: LocalApi | null = null;
  private starting: Promise<void> | null = null;
  private refreshing = false;
  syncing = false;
  error: string | null = null;
  serverReachable: boolean | null = null;

  constructor(
    private readonly log: Logger,
    private readonly settings: () => FallbackSettings | null,
    private readonly save: (next: FallbackSettings | null) => void,
    private readonly postgresHome: () => Promise<string>
  ) {}

  static folder() {
    return join(paths.userData(), 'fallback');
  }

  private uploadsDir() {
    return join(FallbackCounter.folder(), 'uploads');
  }

  /** The local API, once running. */
  get baseUrl() {
    return this.api?.port ? this.api.baseUrl : null;
  }

  status(): FallbackStatus {
    const settings = this.settings();
    return {
      configured: !!settings,
      counterId: settings?.counterId ?? null,
      counterName: settings?.counterName ?? null,
      ready: !!settings?.refreshedAt,
      refreshedAt: settings?.refreshedAt ?? null,
      active: !!settings?.active,
      pendingSync: !!settings?.pendingSync,
      syncing: this.syncing,
      serverReachable: this.serverReachable,
      error: this.error
    };
  }

  /** The database and the local API; started once, kept running. */
  start() {
    if (this.api?.port) return Promise.resolve();
    this.starting ??= this.startNow().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async startNow() {
    const settings = this.settings();
    if (!settings) return;
    this.postgres ??= new LocalPostgres(
      await this.postgresHome(),
      settings.dbPassword,
      this.log,
      join(FallbackCounter.folder(), 'pgdata'),
      'fallback-postgres.log'
    );
    await this.postgres.start();
    await runMigrations(this.postgres.databaseUrl, this.log);
    await this.startApi();
  }

  private async startApi() {
    const settings = this.settings();
    if (!settings || !this.postgres) return;
    this.api = new LocalApi(this.log, (detail) => {
      this.error = `The offline copy stopped: ${detail}`;
      this.log(this.error);
    });
    await this.api.start({
      databaseUrl: this.postgres.databaseUrl,
      authSecret: settings.authSecret,
      corsOrigin: APP_ORIGIN,
      uploadsDir: this.uploadsDir(),
      extraEnv: { POS_FALLBACK: '1', POS_FALLBACK_COUNTER_ID: settings.counterId, POS_FALLBACK_SECRET: settings.localSecret }
    });
    this.log(`Fallback copy listening on ${this.api.baseUrl}`);
  }

  async stop() {
    await this.api?.stop();
    this.api = null;
    await this.postgres?.stop();
    this.postgres = null;
  }

  /** Stops it and deletes the local copy (this computer is an ordinary till again). */
  async remove() {
    await this.stop();
    await rm(FallbackCounter.folder(), { recursive: true, force: true });
  }

  /**
   * Replaces the local copy with the server's latest. Never while offline sales are waiting:
   * they live only in this copy until they are sent.
   */
  async refresh() {
    const settings = this.settings();
    if (!settings || settings.active || settings.pendingSync || this.refreshing || this.syncing) return false;
    this.refreshing = true;
    const file = join(FallbackCounter.folder(), 'copy.zip');
    try {
      await this.start();
      const res = await net.fetch(`${settings.server}/fallback/snapshot`, {
        headers: { [FALLBACK_KEY_HEADER]: settings.key, 'x-pos-client-version': app.getVersion() },
        signal: AbortSignal.timeout(5 * 60_000)
      });
      if (!res.ok || !res.body) throw new Error(await failure(res, "Couldn't get the offline copy from the server"));
      await mkdir(FallbackCounter.folder(), { recursive: true });
      await pipeline(Readable.fromWeb(res.body as import('stream/web').ReadableStream), createWriteStream(file));
      // Checked again: a sale can't have started meanwhile (only while active), but be sure.
      const now = this.settings();
      if (!now || now.active || now.pendingSync) return false;
      await this.api?.stop();
      try {
        await runScript(join(paths.api(), 'dist', 'backup', 'cli.js'), ['restore', '--file', file, '--uploads', this.uploadsDir()], {
          env: baseEnv(this.postgres!.databaseUrl),
          log: this.log,
          failure: "Couldn't load the offline copy"
        });
      } finally {
        await this.startApi();
      }
      this.save({ ...now, refreshedAt: new Date().toISOString() });
      this.error = null;
      this.log('Offline copy refreshed');
      return true;
    } catch (error) {
      this.error = describe(error);
      this.log(`Refreshing the offline copy failed: ${this.error}`);
      return false;
    } finally {
      this.refreshing = false;
      await rm(file, { force: true }).catch(() => undefined);
    }
  }

  /** Moves the copy's invoice numbering past what was issued online since it was made. */
  async catchUpNumbers() {
    const settings = this.settings();
    if (!settings || !this.baseUrl) return;
    const invoiceNumbers = Object.entries(settings.issued ?? {}).map(([prefix, seq]) => `${prefix}/${String(seq).padStart(5, '0')}`);
    if (invoiceNumbers.length === 0) return;
    const res = await net.fetch(`${this.baseUrl}/fallback/numbers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [FALLBACK_SECRET_HEADER]: settings.localSecret },
      body: JSON.stringify({ invoiceNumbers }),
      signal: AbortSignal.timeout(30_000)
    });
    if (!res.ok) throw new Error(await failure(res, "Couldn't bring the offline copy's invoice numbers up to date"));
  }

  /** Sends everything made offline to the server. Safe to repeat: the server keys rows by id. */
  async sync() {
    const settings = this.settings();
    if (!settings) throw new Error('This computer is not a fallback counter');
    await this.start();
    if (!this.baseUrl) throw new Error("The offline copy isn't running");
    const outbox = await net.fetch(`${this.baseUrl}/fallback/outbox`, {
      headers: { [FALLBACK_SECRET_HEADER]: settings.localSecret },
      signal: AbortSignal.timeout(60_000)
    });
    if (!outbox.ok) throw new Error(await failure(outbox, "Couldn't read the offline sales"));
    const body = await outbox.text();
    const res = await net.fetch(`${settings.server}/fallback/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [FALLBACK_KEY_HEADER]: settings.key, 'x-pos-client-version': app.getVersion() },
      body,
      signal: AbortSignal.timeout(5 * 60_000)
    });
    if (!res.ok) throw new Error(await failure(res, "The server didn't take the offline sales"));
    return (await res.json()) as { invoices: number; registers: number };
  }

  /** Whether the server answers right now. */
  async probe() {
    const settings = this.settings();
    if (!settings) return null;
    try {
      const res = await net.fetch(`${settings.server}/meta`, { signal: AbortSignal.timeout(5_000) });
      this.serverReachable = res.ok;
    } catch {
      this.serverReachable = false;
    }
    return this.serverReachable;
  }
}
