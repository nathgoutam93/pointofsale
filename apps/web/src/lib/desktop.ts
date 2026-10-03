/**
 * What the desktop app (apps/desktop) exposes to the web app through its preload script.
 * In a plain browser there is no bridge and `desktop` is null.
 */
import type { ReceiptPaper } from '@pos/contracts';

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

/** Moved; or the owner's email needs the code just emailed to it (nothing changed yet). */
export type MoveResult =
  | { businessId: string; businessCode: string; businessName: string; server: string; emailCodeRequired?: undefined }
  | { emailCodeRequired: true; message: string };

export type ModeChoice = { mode: 'offline' } | { mode: 'online'; apiBaseUrl: string };

export type BackupEntry = {
  file: string;
  createdAt: string;
  reason: 'daily' | 'manual' | 'before-update' | 'before-restore' | 'before-move';
  bytes: number;
};

/** Local backups (offline mode, admins only: the app asks the local API who is signed in). */
export type BackupCopyStatus = { at: string; ok: boolean; file: string | null; error: string | null };

export type DesktopBackups = {
  list(): Promise<{
    days: number;
    folder: string;
    /** A second folder every backup is copied to, if chosen. */
    copyFolder: string | null;
    copyStatus: BackupCopyStatus | null;
    backups: BackupEntry[];
  }>;
  /** Asks for a folder (system dialog) and copies the newest backup there at once. */
  chooseCopyFolder(): Promise<{ copyFolder: string | null; copyStatus: BackupCopyStatus | null }>;
  stopCopying(): Promise<void>;
  setDays(days: number): Promise<number>;
  create(): Promise<void>;
  /** Replaces the business with the backup, then reloads the window at the sign-in screen. */
  restore(file: string): Promise<void>;
  openFolder(): Promise<void>;
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

/** How this computer prints receipts (kept by the desktop app; printers belong to the computer). */
export type PrintingSettings = {
  /** Receipts go straight to this printer. null: every print opens the system dialog. */
  printerName: string | null;
  /** Print the receipt as soon as a sale is paid at the POS. */
  autoPrint: boolean;
  /** Open the cash drawer (plugged into the receipt printer) when cash is taken or refunded. */
  openDrawer: boolean;
  drawerPin: 2 | 5;
  /** The paper this computer's printer takes, overriding the branch's layout. null: the branch's. */
  paper: ReceiptPaper | null;
};

export type PrinterInfo = { name: string; displayName: string };

/** The receipt to print: #printable-invoice's outer HTML and the CSS that styles it. */
export type ReceiptJob = { markup: string; css: string; columns: number; paperMm: 58 | 80 };

export type DesktopPrinting = {
  settings(): Promise<PrintingSettings>;
  printers(): Promise<PrinterInfo[]>;
  /** Admins only (the app asks the API who is signed in). */
  save(settings: PrintingSettings): Promise<PrintingSettings>;
  /** Prints to the receipt printer without a dialog; fails when none is set up. */
  printReceipt(job: ReceiptJob): Promise<void>;
  /** Opens the cash drawer if it's switched on; answers whether it did. */
  openDrawer(): Promise<boolean>;
  /** Admins only: opens the drawer even when it's switched off, to check the wiring. */
  testDrawer(): Promise<void>;
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
  ): Promise<
    | { server: string; business: { id: string; code: string; name: string }; session: unknown; emailCodeRequired?: undefined }
    // The owner's email isn't verified yet: a code was emailed; send again with `emailCode`.
    | { emailCodeRequired: true; message: string }
  >;
  /**
   * A forgotten owner password, sent by the app to `address` (empty: this computer's online
   * server, else the built-in one): "request" emails a code, "confirm" sets the new password.
   */
  ownerPasswordReset(address: string, step: "request" | "confirm", details: Record<string, unknown>): Promise<{ server: string }>;
  /** First launch: picks a backup file and restores its business here; false if no file was chosen. */
  restoreFromBackup(): Promise<{ restored: boolean }>;
  /** Back to the app's first screen. */
  reload(): Promise<void>;
  /** Offline, admins: moves the business online; afterwards this computer works online. */
  moveOnline(input: { server?: string; ownerEmail: string; ownerPassword: string; emailCode?: string }): Promise<MoveResult>;
  onMoveOnlineProgress(listener: (step: MoveStep) => void): () => void;
  backups?: DesktopBackups;
  updates?: DesktopUpdates;
  /** Missing in versions of the desktop app from before receipt printers. */
  printing?: DesktopPrinting;
};

declare global {
  interface Window {
    posDesktop?: DesktopBridge;
  }
}

export const desktop: DesktopBridge | null = typeof window !== 'undefined' ? window.posDesktop ?? null : null;
