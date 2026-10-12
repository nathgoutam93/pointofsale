import { app, dialog } from 'electron';
import { randomUUID } from 'crypto';
import { loadConfig, saveConfig } from './config.js';
import { crashDetails } from './crash-reports.js';
import { apiTarget, fallback, FALLBACK_PROBE_MS, fallbackTimers, noteInvoiceIssued, onServerAnswer, probeServer, startFallback } from './fallback-counter.js';
import { registerAppHandlers } from './ipc-app.js';
import { registerBackupHandlers } from './ipc-backups.js';
import { registerFallbackHandlers } from './ipc-fallback.js';
import { registerPrintingHandlers } from './ipc-printing.js';
import { registerSetupHandlers } from './ipc-setup.js';
import { logger } from './log.js';
import { describe } from './postgres.js';
import { registerAppScheme, serveWebApp } from './protocol.js';
import { checkServerDetails, startOffline, stopOffline, updates } from './services.js';
import { config, crashes, setConfig } from './state.js';
import { createWindow, loadApp, LOADING_PAGE, setWindow, showStartupError, window } from './window.js';

// After installing an update on quit, the Linux (AppImage) updater runs the new version once
// with this set and waits for it to exit; it must not start the app.
if (process.env.APPIMAGE_EXIT_AFTER_INSTALL === 'true') {
  app.exit(0);
}

registerAppScheme();

const log = logger('main');
setConfig(loadConfig());
let stopping = false;

process.on('uncaughtException', (error) => {
  log(`Uncaught error: ${error?.stack ?? String(error)}`);
  crashes.report('desktop', crashDetails(error));
  // As Electron would without this handler: say so, and carry on.
  dialog.showErrorBox('Point of Sale ran into a problem', `${crashDetails(error).message}\n\nIf it keeps happening, restart the app.`);
});
process.on('unhandledRejection', (reason) => {
  log(`Unhandled rejection: ${reason instanceof Error ? reason.stack : String(reason)}`);
  crashes.report('desktop', crashDetails(reason));
});
app.on('render-process-gone', (_event, _contents, details) => {
  if (details.reason === 'clean-exit') return;
  log(`The window's page stopped: ${details.reason} (exit ${details.exitCode})`);
  crashes.report('desktop', { message: `The window's page stopped: ${details.reason} (exit ${details.exitCode})`, stack: '' });
});
app.on('child-process-gone', (_event, details) => {
  if (details.reason === 'clean-exit' || details.reason === 'killed') return;
  crashes.report('desktop', { message: `A ${details.type} process stopped: ${details.reason} (exit ${details.exitCode})`, stack: '' });
});
let stopped = false;

// This computer's id, made once: a fallback counter opens only on its own computer.
if (!config.deviceId) {
  setConfig({ ...config, deviceId: randomUUID() });
  saveConfig(config);
}

registerSetupHandlers();
registerBackupHandlers();
registerPrintingHandlers();
registerFallbackHandlers();
registerAppHandlers();

if (!app.requestSingleInstanceLock()) {
  // Another window already runs this app (and its database); show that one instead.
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  app.whenReady().then(async () => {
    log(`Starting version ${app.getVersion()} in ${config.mode ?? 'first-run'} mode`);
    serveWebApp(apiTarget, () => config.deviceId as string, onServerAnswer, noteInvoiceIssued);
    setWindow(createWindow());
    await window?.loadURL(LOADING_PAGE);
    try {
      if (config.mode === 'offline') await startOffline();
      await startFallback();
      await loadApp();
    } catch (error) {
      await showStartupError(error);
      return;
    }
    updates.start();
    void checkServerDetails();
    void probeServer();
    setInterval(() => void probeServer(), FALLBACK_PROBE_MS).unref();
    void crashes.flush();
    setInterval(() => void crashes.flush(), 10 * 60 * 1000).unref();
  });

  app.on('window-all-closed', () => app.quit());

  // Stop the API and the database cleanly before exiting.
  app.on('before-quit', (event) => {
    if (stopped) return;
    event.preventDefault();
    if (stopping) return;
    stopping = true;
    for (const timer of fallbackTimers) clearInterval(timer);
    void Promise.all([stopOffline(), fallback.stop()])
      .catch((error) => log(`Shutdown problem: ${describe(error)}`))
      .finally(() => {
        stopped = true;
        app.quit();
      });
  });
}
