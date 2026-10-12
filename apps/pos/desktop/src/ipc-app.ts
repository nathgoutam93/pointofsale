import { ipcMain, shell } from 'electron';
import { saveConfig } from './config.js';
import { assertFromApp } from './ipc-access.js';
import { logger } from './log.js';
import { paths } from './paths.js';
import { updates } from './services.js';
import { config, crashes, setConfig } from './state.js';
import { loadApp } from './window.js';

const log = logger('main');

/** Updates, crash reports, the logs folder, reloading and payments. */
export function registerAppHandlers() {
  ipcMain.handle('pos:updates:status', (event) => {
    assertFromApp(event);
    return updates.current;
  });

  ipcMain.handle('pos:updates:check', async (event) => {
    assertFromApp(event);
    await updates.check();
    return updates.current;
  });

  ipcMain.handle('pos:updates:install', async (event) => {
    assertFromApp(event);
    await updates.installNow();
  });

  /** The page got 426 from the server: this version is too old for it. */
  ipcMain.handle('pos:updates:require', (event, minimum: unknown) => {
    assertFromApp(event);
    if (typeof minimum === 'string') updates.require(minimum);
    return updates.current;
  });

  /** Start the app again from its first screen (after moving online, the online sign-in). */
  ipcMain.handle('pos:reload', (event) => {
    assertFromApp(event);
    setImmediate(() => void loadApp());
  });

  /** Crash reports: whether they may be sent (null: not asked yet) and how many wait to be. */
  ipcMain.handle('pos:crash-reports:status', (event) => {
    assertFromApp(event);
    return { enabled: config.crashReports, queued: crashes.queued() };
  });

  /** An admin's answer: yes sends what waits (and what comes); no drops it. */
  ipcMain.handle('pos:crash-reports:set', (event, enabled: unknown) => {
    assertFromApp(event);
    if (typeof enabled !== 'boolean') throw new Error('Choose yes or no');
    setConfig({ ...config, crashReports: enabled });
    saveConfig(config);
    if (enabled) void crashes.flush();
    else crashes.clear();
    log(`Crash reports ${enabled ? 'turned on' : 'turned off'}`);
    return { enabled, queued: crashes.queued() };
  });

  /** A crash of the screens (the page has already kept only the first line and the frames). */
  ipcMain.handle('pos:crash-reports:report', (event, report: { message?: unknown; stack?: unknown }) => {
    assertFromApp(event);
    if (typeof report?.message !== 'string') return;
    crashes.report('page', { message: report.message.slice(0, 500), stack: typeof report.stack === 'string' ? report.stack.slice(0, 8000) : '' });
  });

  ipcMain.handle('pos:open-logs', async (event) => {
    assertFromApp(event);
    await shell.openPath(paths.logs());
  });

  /**
   * Online, managed hosting: a subscription payment, paid in the system browser. Only this app's
   * own server's /billing/pay/<id> is opened; the server sends the browser on to its gateway.
   */
  ipcMain.handle('pos:open-payment', async (event, path: unknown) => {
    assertFromApp(event);
    if (config.mode !== 'online' || !config.apiBaseUrl) throw new Error('Only for online businesses');
    if (typeof path !== 'string' || !/^\/billing\/pay\/[0-9a-f-]{36}$/i.test(path)) throw new Error('Not a payment link');
    await shell.openExternal(`${config.apiBaseUrl}${path}`);
  });
}
