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
  /** The hosted server built into this app; null when people type an address. */
  defaultServerUrl: string | null;
};

export type MoveStep = 'checking' | 'account' | 'backup' | 'pausing' | 'exporting' | 'uploading' | 'finishing';

export type MoveResult = { businessId: string; businessCode: string; businessName: string; server: string };

export type ModeChoice = { mode: 'offline' } | { mode: 'online'; apiBaseUrl: string };

export type BackupEntry = {
  file: string;
  createdAt: string;
  reason: 'daily' | 'manual' | 'before-update' | 'before-restore' | 'before-move';
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

export type UpdateStatus = {
  state: 'idle' | 'checking' | 'none' | 'downloading' | 'ready' | 'error' | 'unsupported';
  currentVersion: string;
  /** The version being downloaded or ready to install. */
  availableVersion: string | null;
  /** Download progress, 0–100. */
  percent: number | null;
  error: string | null;
  /** Set when the server needs at least this version: the app can't be used until it updates. */
  required: string | null;
};

export type DesktopUpdates = {
  status(): Promise<UpdateStatus>;
  check(): Promise<UpdateStatus>;
  /** Stops the local services and restarts into the downloaded version. */
  installNow(): Promise<void>;
  /** The server answered 426: this version is too old for it. */
  require(minimum: string): Promise<UpdateStatus>;
  onStatus(listener: (status: UpdateStatus) => void): () => void;
};

export type DesktopBridge = {
  config: DesktopConfig;
  version: string;
  /** Saves the choice, starts what it needs (the local database and API offline) and reloads the window. */
  chooseMode(choice: ModeChoice): Promise<void>;
  openLogsFolder(): Promise<void>;
  /** Checks an address (empty: the built-in one) is an online server; answers it tidied. */
  checkServer(address: string): Promise<string>;
  /** First launch: creates a business on the server (sent by the app, not the page). */
  createOnlineBusiness(
    address: string,
    details: Record<string, unknown>
  ): Promise<{ server: string; business: { id: string; code: string; name: string }; session: unknown }>;
  /** Back to the app's first screen. */
  reload(): Promise<void>;
  /** Offline, admins: moves the business online; afterwards this computer works online. */
  moveOnline(token: string, input: { server?: string; ownerEmail: string; ownerPassword: string }): Promise<MoveResult>;
  onMoveOnlineProgress(listener: (step: MoveStep) => void): () => void;
  backups?: DesktopBackups;
  updates?: DesktopUpdates;
};

declare global {
  interface Window {
    posDesktop?: DesktopBridge;
  }
}

export const desktop: DesktopBridge | null = typeof window !== 'undefined' ? window.posDesktop ?? null : null;
