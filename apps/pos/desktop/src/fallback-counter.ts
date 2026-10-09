import { net } from 'electron';
import { saveConfig } from './config.js';
import { FallbackCounter } from './fallback.js';
import { logger } from './log.js';
import { paths } from './paths.js';
import { describe } from './postgres.js';
import type { ApiTarget } from './protocol.js';
import { api } from './services.js';
import { config, setConfig } from './state.js';
import { window } from './window.js';

const log = logger('main');

/** Online: this computer as its branch's fallback counter (selling while the server is down). */
export const fallback = new FallbackCounter(
  logger('fallback'),
  () => (config.mode === 'online' ? config.fallback : null),
  (next) => {
    setConfig({ ...config, fallback: next });
    saveConfig(config);
    notifyFallback();
  },
  () => paths.postgresHome()
);
export let fallbackTimers: NodeJS.Timeout[] = [];

export function setFallbackTimers(next: NodeJS.Timeout[]) {
  fallbackTimers = next;
}

const FALLBACK_REFRESH_MS = 10 * 60 * 1000;
export const FALLBACK_PROBE_MS = 30 * 1000;

export function notifyFallback() {
  window?.webContents.send('pos:fallback-status', fallback.status());
}

/**
 * The API the web app talks to: the local one offline, the hosted one online, or the fallback
 * counter's local copy while it sells without the server.
 */
export function currentApiBaseUrl() {
  if (config.mode === 'offline') return api?.port ? api.baseUrl : null;
  if (config.mode === 'online') return config.fallback?.active ? fallback.baseUrl : config.apiBaseUrl;
  return null;
}

/**
 * An invoice or return the server just numbered through this computer. A fallback counter's
 * series are only ever issued here, so the last one seen is the series' last: offline ones
 * carry on after it.
 */
export function noteInvoiceIssued(invoiceNo: string) {
  const settings = config.fallback;
  if (config.mode !== 'online' || !settings || settings.active) return;
  const at = invoiceNo.lastIndexOf('/');
  const prefix = invoiceNo.slice(0, at);
  const seq = Number(invoiceNo.slice(at + 1));
  if (at <= 0 || !Number.isInteger(seq) || (settings.issued?.[prefix] ?? 0) >= seq) return;
  setConfig({ ...config, fallback: { ...settings, issued: { ...settings.issued, [prefix]: seq } } });
  saveConfig(config);
}

/** Where the page's requests go right now. */
export function apiTarget(): ApiTarget {
  if (config.mode === 'online' && fallback.syncing) {
    return { base: null, unavailable: 'Sending the offline sales to the server. Try again in a moment.' };
  }
  return { base: currentApiBaseUrl() };
}

/**
 * Whether the online server answers, as the page's requests find out; the banner follows it.
 * A register opened or closed on the fallback counter refreshes its copy, so the copy has the
 * register that is open if the server goes down next.
 */
export function onServerAnswer(base: string, reachable: boolean, request: { method: string; path: string; status: number }) {
  if (config.mode !== 'online' || base !== config.apiBaseUrl) return;
  if (
    config.fallback &&
    request.method === 'POST' &&
    (request.path === '/registers/open' || request.path === '/registers/close') &&
    request.status === 200
  ) {
    void fallback.refresh().then(() => notifyFallback());
  }
  if (fallback.serverReachable === reachable) return;
  fallback.serverReachable = reachable;
  log(reachable ? 'The server answers again' : "Can't reach the server");
  notifyFallback();
}

/**
 * Online: whether the server answers, checked every 30 seconds in the background, so the banner
 * (and the fallback counter's offer to keep selling) shows before a sale fails, and the offer to
 * send offline sales shows once the server is back.
 */
export async function probeServer() {
  if (config.mode !== 'online' || !config.apiBaseUrl) return;
  let reachable: boolean;
  try {
    const res = await net.fetch(`${config.apiBaseUrl}/meta`, { signal: AbortSignal.timeout(5_000) });
    reachable = res.ok;
  } catch {
    reachable = false;
  }
  if (config.mode !== 'online' || fallback.serverReachable === reachable) return;
  fallback.serverReachable = reachable;
  log(reachable ? 'The server answers again' : "Can't reach the server");
  notifyFallback();
}

/**
 * The fallback counter at startup: its local copy running (before the page, if it is selling
 * from it) and refreshed every 10 minutes while online.
 */
export async function startFallback(options: { refreshNow?: boolean } = {}) {
  for (const timer of fallbackTimers) clearInterval(timer);
  fallbackTimers = [];
  if (config.mode !== 'online' || !config.fallback) return;
  if (config.fallback.active) {
    await fallback.start().catch((error) => log(`The offline copy didn't start: ${describe(error)}`));
  } else if (options.refreshNow !== false) {
    void fallback
      .start()
      .then(() => fallback.refresh())
      .then(() => notifyFallback())
      .catch((error) => log(`The offline copy didn't start: ${describe(error)}`));
  }
  fallbackTimers.push(
    setInterval(() => {
      if (!config.fallback?.active) void fallback.refresh().then(() => notifyFallback());
    }, FALLBACK_REFRESH_MS)
  );
}

export function currentApiOrigin() {
  const base = currentApiBaseUrl();
  return base ? new URL(base).origin : null;
}
