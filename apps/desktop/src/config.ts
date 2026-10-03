import { randomBytes } from 'crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { paths } from './paths.js';

export type Mode = 'offline' | 'online';

/** Saved in userData/config.json, readable only by the signed-in user. */
export type DesktopConfig = {
  /** null until the owner picks a business type on first launch. */
  mode: Mode | null;
  /** Online: the hosted API. Offline: unused (the local API's port changes each launch). */
  apiBaseUrl: string | null;
  /** Offline: the local database's password and the local API's token signing key. */
  dbPassword: string | null;
  authSecret: string | null;
};

const EMPTY: DesktopConfig = { mode: null, apiBaseUrl: null, dbPassword: null, authSecret: null };

export function loadConfig(): DesktopConfig {
  const file = paths.config();
  if (!existsSync(file)) return { ...EMPTY };
  const saved = JSON.parse(readFileSync(file, 'utf8')) as Partial<DesktopConfig>;
  return { ...EMPTY, ...saved };
}

export function saveConfig(config: DesktopConfig) {
  const file = paths.config();
  // Write then rename, so a crash mid-write never leaves a broken config.
  writeFileSync(`${file}.tmp`, JSON.stringify(config, null, 2), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}

/** The offline secrets, created once and kept: the database password can't change after initdb. */
export function withOfflineSecrets(config: DesktopConfig): DesktopConfig {
  return {
    ...config,
    dbPassword: config.dbPassword ?? randomBytes(24).toString('hex'),
    authSecret: config.authSecret ?? randomBytes(48).toString('base64url')
  };
}
