/**
 * What the desktop app (apps/desktop) exposes to the web app through its preload script.
 * In a plain browser there is no bridge and `desktop` is null.
 */
export type DesktopMode = 'offline' | 'online';

export type DesktopConfig = {
  /** null until the owner picks a business type on first launch. */
  mode: DesktopMode | null;
  /** The API this window talks to: the local API offline, the hosted one online. */
  apiBaseUrl: string | null;
};

export type ModeChoice = { mode: 'offline' } | { mode: 'online'; apiBaseUrl: string };

export type BackupEntry = {
  file: string;
  createdAt: string;
  reason: 'daily' | 'manual' | 'before-update' | 'before-restore';
  bytes: number;
};

/** Local backups (offline mode, admins only: the app checks the token with the local API). */
export type DesktopBackups = {
  list(token: string): Promise<{ days: number; folder: string; backups: BackupEntry[] }>;
  setDays(token: string, days: number): Promise<number>;
  create(token: string): Promise<void>;
  /** Replaces the business with the backup, then reloads the window at the sign-in screen. */
  restore(token: string, file: string): Promise<void>;
  openFolder(token: string): Promise<void>;
};

export type DesktopBridge = {
  config: DesktopConfig;
  version: string;
  /** Saves the choice, starts what it needs (the local database and API offline) and reloads the window. */
  chooseMode(choice: ModeChoice): Promise<void>;
  openLogsFolder(): Promise<void>;
  backups?: DesktopBackups;
};

declare global {
  interface Window {
    posDesktop?: DesktopBridge;
  }
}

export const desktop: DesktopBridge | null = typeof window !== 'undefined' ? window.posDesktop ?? null : null;
