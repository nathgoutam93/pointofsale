import { app } from 'electron';
import updater from 'electron-updater';
import type { Logger } from './log.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Checks for a new release at launch and every 24 hours while the app runs. Updates download
 * in the background and install when the app next quits, never in the middle of a sale. The
 * new version then brings the local database up to its schema on the next start.
 * Releases come from the `publish` setting in electron-builder.yml.
 */
export function startUpdateChecks(log: Logger) {
  if (!app.isPackaged) {
    log('Update checks are off when running from source');
    return;
  }
  const { autoUpdater } = updater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = { info: log, warn: log, error: log, debug: () => undefined };
  autoUpdater.on('update-downloaded', (info) => log(`Version ${info.version} downloaded; it installs when the app closes`));

  const check = () =>
    autoUpdater.checkForUpdates().catch((error: unknown) => {
      // Offline shops are often without internet; try again at the next check.
      log(`Update check failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  void check();
  setInterval(check, DAY_MS).unref();
}
