import { app } from 'electron';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { DesktopConfig } from './config.js';
import { CrashReports } from './crash-reports.js';
import { logger } from './log.js';

/** This computer's settings (userData/config.json), loaded at startup by main.ts. */
export let config: DesktopConfig;

export function setConfig(next: DesktopConfig) {
  config = next;
}

/**
 * Crashes of this app, its local API and its screens: kept on this computer and, once an admin
 * says yes, sent to the online server (this business's, or the hosted one for an offline install).
 */
export const crashes = new CrashReports(logger('crash-reports'), () => ({
  enabled: config.crashReports,
  server: config.mode === 'online' ? config.apiBaseUrl : defaultServerUrl,
  mode: config.mode === 'online' ? (config.fallback?.active ? 'fallback' : 'online') : 'offline',
  installId: config.deviceId
}));

/**
 * The hosted server this build signs up and moves businesses to: `posServerUrl` in the
 * app's package.json (POS_SERVER_URL overrides it). Empty: people type the address.
 */
export const defaultServerUrl = (() => {
  if (process.env.POS_SERVER_URL) return process.env.POS_SERVER_URL;
  try {
    const manifest = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')) as { posServerUrl?: string };
    return manifest.posServerUrl || null;
  } catch {
    return null;
  }
})();
