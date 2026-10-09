import { app, net, session } from 'electron';
import { LocalApi, runMigrations } from './api-server.js';
import { Backups } from './backups.js';
import { cleanHosting, saveConfig, withOfflineSecrets } from './config.js';
import { logger } from './log.js';
import { paths } from './paths.js';
import { describe, LocalPostgres } from './postgres.js';
import { APP_ORIGIN } from './protocol.js';
import { config, crashes, setConfig } from './state.js';
import { olderThan, Updater } from './updater.js';
import { showStartupError } from './window.js';

const log = logger('main');
let postgres: LocalPostgres | null = null;
export let api: LocalApi | null = null;
let backupTimer: NodeJS.Timeout | null = null;
const HOUR_MS = 60 * 60 * 1000;

export const updates = new Updater(logger('updater'), () => stopOffline());

export const backups = new Backups(
  logger('backups'),
  () => {
    if (!postgres) throw new Error('The database is not running');
    return postgres.databaseUrl;
  },
  () => config.backupDays,
  {
    folder: () => config.backupCopyFolder,
    record: (status) => {
      setConfig({ ...config, backupCopyStatus: { ...status, at: new Date().toISOString() } });
      saveConfig(config);
    }
  }
);

/**
 * A request to the API with this app's sign-in cookie (the page's, kept in the app's cookie
 * store). The cookie-session header is what lets the API read it.
 */
export function sessionFetch(url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('x-pos-session', 'cookie');
  headers.set('x-pos-client-version', app.getVersion());
  return net.fetch(url, { ...init, headers });
}

/** Offline mode: the bundled database, migrated to this version's schema, and the API on top. */
export async function startOffline() {
  if (!config.dbPassword || !config.authSecret) {
    // Saved before the database is created: its password can never be recovered later.
    setConfig(withOfflineSecrets(config));
    saveConfig(config);
  }
  postgres = new LocalPostgres(await paths.postgresHome(), config.dbPassword as string, logger('postgres'));
  await postgres.start();
  // Today's backup, or a copy from before an update changes the database. A failed backup
  // is logged, not fatal: the shop must still be able to sell.
  await backups.daily({ beforeUpdate: true }).catch((error) => log(`Backup before start failed: ${describe(error)}`));
  await startApi();
  if (await switchIfMoved()) return;
  backupTimer = setInterval(() => {
    void backups
      .daily()
      .then(() => {
        // The second folder was unavailable last time (USB drive unplugged): try again.
        if (config.backupCopyFolder && config.backupCopyStatus && !config.backupCopyStatus.ok) return backups.copyLatest();
      })
      .catch((error) => log(`Daily backup failed: ${describe(error)}`));
  }, HOUR_MS);
  backupTimer.unref();
}

/**
 * The business already moved online (the app stopped right after the move, before switching):
 * switch now. Returns true when it did.
 */
export async function switchIfMoved() {
  if (!api) return false;
  try {
    const meta = (await (await fetch(`${api.baseUrl}/meta`)).json()) as { movedTo?: { server: string } | null };
    if (!meta.movedTo) return false;
    log(`This business moved online to ${meta.movedTo.server}; switching`);
    await switchToOnline(meta.movedTo.server);
    return true;
  } catch (error) {
    log(`Couldn't check whether the business moved: ${describe(error)}`);
    return false;
  }
}

/** From now on this computer uses the online business; the local data stays as a read-only copy. */
export async function switchToOnline(server: string) {
  const localBase = api?.baseUrl ?? null;
  setConfig({ ...config, mode: 'online', apiBaseUrl: server, hosting: null, pendingImportId: null });
  saveConfig(config);
  await checkServerDetails();
  await stopOffline();
  // The sign-in to the local API is of no more use; the online server sets its own.
  if (localBase) await session.defaultSession.cookies.remove(localBase, 'pos_session').catch(() => undefined);
}

/** Migrations, then the API. Also used to bring the API back after a restore. */
export async function startApi() {
  if (!postgres) throw new Error('The database is not running');
  log('Applying migrations');
  await runMigrations(postgres.databaseUrl, logger('migrations'));
  log('Migrations done; starting the API');
  api = new LocalApi(logger('api'), (detail) => {
    log(detail);
    // Its last lines may quote data: only the exit code and stack frames go in the report.
    crashes.report('local-api', { message: detail.split(':')[0] ?? 'The API stopped', stack: (detail.match(/at [^()\s]+ \([^)]+\)/g) ?? []).join('\n') });
    void showStartupError(new Error('The background service stopped unexpectedly.'), detail);
  });
  await api.start({ databaseUrl: postgres.databaseUrl, authSecret: config.authSecret as string, corsOrigin: APP_ORIGIN });
  log(`API listening on ${api.baseUrl}`);
}

export async function stopApi() {
  await api?.stop();
  api = null;
}

export async function stopOffline() {
  if (backupTimer) clearInterval(backupTimer);
  backupTimer = null;
  await api?.stop();
  api = null;
  await postgres?.stop();
  postgres = null;
}

/**
 * Online mode, at launch and on connecting: what the server says about itself. One that needs a
 * newer app makes the app update before anything else; whether it is our managed service or a
 * business's own server is kept for when it can't be reached.
 */
export async function checkServerDetails() {
  if (config.mode !== 'online' || !config.apiBaseUrl) return;
  const server = config.apiBaseUrl;
  try {
    const res = await fetch(`${server}/meta`, { signal: AbortSignal.timeout(10_000) });
    const meta = (await res.json()) as { minClientVersion?: string | null; hosting?: unknown };
    if (meta.minClientVersion) updates.require(meta.minClientVersion);
    // A server older than this setting doesn't say; leave what was known.
    const hosting = cleanHosting(meta.hosting);
    if (hosting && config.apiBaseUrl === server && config.hosting !== hosting) {
      setConfig({ ...config, hosting });
      saveConfig(config);
    }
  } catch (error) {
    // No internet right now: requests will tell us (426) once it's back.
    log(`Couldn't ask the server about itself: ${describe(error)}`);
  }
}

/** Checks that an address is an online Point of Sale server. */
export async function checkOnlineServer(raw: unknown) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    throw new Error('Enter the server address, for example https://pos.example.com');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('The server address must start with https://');
  }
  const base = `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  let meta: { mode?: string; minClientVersion?: string | null };
  try {
    const res = await fetch(`${base}/meta`, { signal: AbortSignal.timeout(10_000) });
    meta = (await res.json()) as typeof meta;
  } catch {
    throw new Error(`Couldn't reach ${base}. Check the address and your internet connection.`);
  }
  if (meta.mode !== 'online') {
    throw new Error("That address isn't an online Point of Sale server.");
  }
  // A newer app needed: connect anyway; the app then updates itself before it can be used.
  if (meta.minClientVersion && olderThan(app.getVersion(), meta.minClientVersion)) {
    setImmediate(() => updates.require(meta.minClientVersion as string));
  }
  return base;
}
