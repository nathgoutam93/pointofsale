import { randomBytes } from 'crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { paths } from './paths.js';
import { cleanPrintingSettings, DEFAULT_PRINTING, type PrintingSettings } from './printing.js';
import type { FallbackSettings } from './fallback.js';

export type Mode = 'offline' | 'online';

/** Hosting in @pos/contracts (this app doesn't load it): our managed service or a business's own server. */
export type Hosting = 'managed' | 'self';

export const cleanHosting = (value: unknown): Hosting | null => (value === 'managed' || value === 'self' ? value : null);

/** Saved in userData/config.json, readable only by the signed-in user. */
export type DesktopConfig = {
  /** null until the owner picks a business type on first launch. */
  mode: Mode | null;
  /** Online: the hosted API. Offline: unused (the local API's port changes each launch). */
  apiBaseUrl: string | null;
  /** Online: what the server last said it is (its /meta), never judged from its address. null until known. */
  hosting: Hosting | null;
  /** Offline: the local database's password and the local API's token signing key. */
  dbPassword: string | null;
  authSecret: string | null;
  /** Offline: how many days of local backups to keep (2 to 5). */
  backupDays: number;
  /**
   * While moving online: the id the upload is sent with. Kept until the move ends, so a
   * retry after a lost answer gets the same business instead of a second one.
   */
  pendingImportId: string | null;
  /** Offline: a second folder every backup is copied to (USB drive, synced cloud folder). */
  backupCopyFolder: string | null;
  /** How the last copy there went. */
  backupCopyStatus: { at: string; ok: boolean; file: string | null; error: string | null } | null;
  /** The receipt printer and cash drawer on this computer (both modes). */
  printing: PrintingSettings;
  /** This computer's id, sent with every request (a fallback counter opens only on its own). */
  deviceId: string | null;
  /** Online: this computer as its branch's fallback counter; null if it isn't one. */
  fallback: FallbackSettings | null;
  /** Whether crash reports may be sent: null until an admin answers (see crash-reports.ts). */
  crashReports: boolean | null;
};

export const BACKUP_DAYS = { min: 2, max: 5, default: 3 } as const;

export function clampBackupDays(value: unknown) {
  const days = Math.round(Number(value));
  if (!Number.isFinite(days)) return BACKUP_DAYS.default;
  return Math.min(BACKUP_DAYS.max, Math.max(BACKUP_DAYS.min, days));
}

const EMPTY: DesktopConfig = {
  mode: null,
  apiBaseUrl: null,
  hosting: null,
  dbPassword: null,
  authSecret: null,
  backupDays: BACKUP_DAYS.default,
  pendingImportId: null,
  backupCopyFolder: null,
  backupCopyStatus: null,
  printing: DEFAULT_PRINTING,
  deviceId: null,
  fallback: null,
  crashReports: null
};

export function loadConfig(): DesktopConfig {
  const file = paths.config();
  if (!existsSync(file)) return { ...EMPTY };
  const saved = JSON.parse(readFileSync(file, 'utf8')) as Partial<DesktopConfig>;
  const config = { ...EMPTY, ...saved };
  return { ...config, hosting: cleanHosting(config.hosting), backupDays: clampBackupDays(config.backupDays), printing: cleanPrintingSettings(config.printing) };
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
