import { app, BrowserWindow } from 'electron';
import updater from 'electron-updater';
import type { Logger } from './log.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** While an update is required but not found yet (the release may still be publishing). */
const RETRY_REQUIRED_MS = 15 * 60 * 1000;

export type UpdateState = 'idle' | 'checking' | 'none' | 'downloading' | 'ready' | 'error' | 'unsupported';

export type UpdateStatus = {
  state: UpdateState;
  currentVersion: string;
  /** The version being downloaded or ready to install. */
  availableVersion: string | null;
  /** Download progress, 0–100. */
  percent: number | null;
  error: string | null;
  /** Set when the server needs at least this version: the app can't be used until it updates. */
  required: string | null;
};

/** 1.2.3 vs 1.10.0, numerically. */
export function olderThan(version: string, minimum: string) {
  const a = version.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const b = minimum.split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length, 3); i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  }
  return false;
}

/**
 * Keeps the app current. Checks at launch and every 24 hours; updates download in the
 * background and install when the app closes, never in the middle of a sale. Every change
 * is sent to the window, which shows "update ready" and, when the server requires a newer
 * version, blocks use until it is installed. Releases come from `publish` in
 * electron-builder.yml.
 */
export class Updater {
  private status: UpdateStatus;
  private retryTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly log: Logger,
    /** Stops the API and database: an installer can't replace files they hold open. */
    private readonly beforeInstall: () => Promise<void>
  ) {
    this.status = {
      state: app.isPackaged ? 'idle' : 'unsupported',
      currentVersion: app.getVersion(),
      availableVersion: null,
      percent: null,
      error: null,
      required: null
    };
  }

  get current() {
    return this.status;
  }

  private set(patch: Partial<UpdateStatus>) {
    this.status = { ...this.status, ...patch };
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('pos:update-status', this.status);
    }
  }

  start() {
    if (!app.isPackaged) {
      this.log('Update checks are off when running from source');
      return;
    }
    const { autoUpdater } = updater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = { info: this.log, warn: this.log, error: this.log, debug: () => undefined };
    autoUpdater.on('checking-for-update', () => {
      if (this.status.state !== 'downloading' && this.status.state !== 'ready') this.set({ state: 'checking', error: null });
    });
    autoUpdater.on('update-not-available', () => {
      if (this.status.state !== 'ready') this.set({ state: 'none' });
    });
    autoUpdater.on('update-available', (info) => this.set({ state: 'downloading', availableVersion: info.version, percent: 0, error: null }));
    autoUpdater.on('download-progress', (progress) => this.set({ state: 'downloading', percent: Math.round(progress.percent) }));
    autoUpdater.on('update-downloaded', (info) => {
      this.log(`Version ${info.version} downloaded; it installs when the app closes`);
      this.set({ state: 'ready', availableVersion: info.version, percent: 100 });
    });
    autoUpdater.on('error', (error) => {
      this.log(`Update failed: ${error.message}`);
      if (this.status.state !== 'ready') this.set({ state: 'error', error: error.message });
    });
    void this.check();
    setInterval(() => void this.check(), DAY_MS).unref();
  }

  /** Looks for a new version now. Without internet it fails quietly and tries again later. */
  async check() {
    if (!app.isPackaged || this.status.state === 'downloading' || this.status.state === 'ready') return;
    try {
      await updater.autoUpdater.checkForUpdates();
    } catch (error) {
      this.log(`Update check failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * The server says this version is too old. Blocks the app (the window shows it) and fetches
   * the update right away, retrying until one at least `minimum` is downloaded.
   */
  require(minimum: string) {
    if (!/^\d+\.\d+\.\d+$/.test(minimum) || !olderThan(app.getVersion(), minimum)) return;
    if (this.status.required && !olderThan(this.status.required, minimum)) return;
    this.log(`The server needs version ${minimum} or later`);
    this.set({ required: minimum });
    void this.check();
    if (!this.retryTimer) {
      this.retryTimer = setInterval(() => {
        const ready = this.status.state === 'ready' && this.status.availableVersion && !olderThan(this.status.availableVersion, minimum);
        if (!ready) void this.check();
      }, RETRY_REQUIRED_MS);
      this.retryTimer.unref();
    }
  }

  /** Restarts into the downloaded version, after stopping everything it would replace. */
  async installNow() {
    if (this.status.state !== 'ready') throw new Error('No update is ready yet');
    this.log(`Installing version ${this.status.availableVersion}`);
    await this.beforeInstall();
    updater.autoUpdater.quitAndInstall(false, true);
  }
}
