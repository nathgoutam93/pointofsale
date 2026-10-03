import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { LocalApi, runMigrations } from './api-server.js';
import { Backups, backupsFolder } from './backups.js';
import { clampBackupDays, loadConfig, saveConfig, withOfflineSecrets, type DesktopConfig } from './config.js';
import { logger } from './log.js';
import { paths } from './paths.js';
import { describe, LocalPostgres } from './postgres.js';
import { APP_ORIGIN, registerAppScheme, serveWebApp } from './protocol.js';
import { olderThan, Updater } from './updater.js';

// After installing an update on quit, the Linux (AppImage) updater runs the new version once
// with this set and waits for it to exit; it must not start the app.
if (process.env.APPIMAGE_EXIT_AFTER_INSTALL === 'true') {
  app.exit(0);
}

registerAppScheme();

const log = logger('main');
let config: DesktopConfig = loadConfig();
let postgres: LocalPostgres | null = null;
let api: LocalApi | null = null;
let window: BrowserWindow | null = null;
let backupTimer: NodeJS.Timeout | null = null;
const HOUR_MS = 60 * 60 * 1000;

const updates = new Updater(logger('updater'), () => stopOffline());

const backups = new Backups(
  logger('backups'),
  () => {
    if (!postgres) throw new Error('The database is not running');
    return postgres.databaseUrl;
  },
  () => config.backupDays
);
let stopping = false;
let stopped = false;

/** The API the web app talks to: the local one offline, the hosted one online. */
function currentApiBaseUrl() {
  if (config.mode === 'offline') return api?.port ? api.baseUrl : null;
  if (config.mode === 'online') return config.apiBaseUrl;
  return null;
}

function currentApiOrigin() {
  const base = currentApiBaseUrl();
  return base ? new URL(base).origin : null;
}

/** Offline mode: the bundled database, migrated to this version's schema, and the API on top. */
async function startOffline() {
  if (!config.dbPassword || !config.authSecret) {
    // Saved before the database is created: its password can never be recovered later.
    config = withOfflineSecrets(config);
    saveConfig(config);
  }
  postgres = new LocalPostgres(await paths.postgresHome(), config.dbPassword as string, logger('postgres'));
  await postgres.start();
  // Today's backup, or a copy from before an update changes the database. A failed backup
  // is logged, not fatal: the shop must still be able to sell.
  await backups.daily({ beforeUpdate: true }).catch((error) => log(`Backup before start failed: ${describe(error)}`));
  await startApi();
  backupTimer = setInterval(() => {
    void backups.daily().catch((error) => log(`Daily backup failed: ${describe(error)}`));
  }, HOUR_MS);
  backupTimer.unref();
}

/** Migrations, then the API. Also used to bring the API back after a restore. */
async function startApi() {
  if (!postgres) throw new Error('The database is not running');
  log('Applying migrations');
  await runMigrations(postgres.databaseUrl, logger('migrations'));
  log('Migrations done; starting the API');
  api = new LocalApi(logger('api'), (detail) => {
    log(detail);
    void showStartupError(new Error('The background service stopped unexpectedly.'), detail);
  });
  await api.start({ databaseUrl: postgres.databaseUrl, authSecret: config.authSecret as string, corsOrigin: APP_ORIGIN });
  log(`API listening on ${api.baseUrl}`);
}

async function stopApi() {
  await api?.stop();
  api = null;
}

async function stopOffline() {
  if (backupTimer) clearInterval(backupTimer);
  backupTimer = null;
  await api?.stop();
  api = null;
  await postgres?.stop();
  postgres = null;
}

const htmlPage = (body: string) =>
  `data:text/html;charset=utf-8,${encodeURIComponent(
    `<!doctype html><meta charset="utf-8"><title>Point of Sale</title><body style="margin:0;display:grid;place-items:center;height:100vh;font:15px system-ui,sans-serif;color:#334155;background:#f8fafc">${body}</body>`
  )}`;

const LOADING_PAGE = htmlPage('<p>Starting Point of Sale…</p>');

async function showStartupError(error: unknown, detail?: string) {
  log(`Startup failed: ${describe(error)}${detail ? ` | ${detail}` : ''}`);
  const message = error instanceof Error ? error.message : String(error);
  for (;;) {
    const { response } = await dialog.showMessageBox({
      type: 'error',
      title: 'Point of Sale',
      message: "Point of Sale couldn't start",
      detail: `${message}\n\nThe logs folder has the details: ${paths.logs()}`,
      buttons: ['Restart', 'Open logs folder', 'Quit'],
      defaultId: 0,
      cancelId: 2
    });
    if (response === 1) {
      await shell.openPath(paths.logs());
      continue;
    }
    if (response === 0) app.relaunch();
    app.quit();
    return;
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'Point of Sale',
    backgroundColor: '#f8fafc',
    autoHideMenuBar: true,
    webPreferences: {
      preload: paths.preload(),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      // A cashier must not get a console that can call the bridge (restore, settings).
      devTools: !app.isPackaged
    }
  });
  win.once('ready-to-show', () => win.show());
  // The window only ever shows the app itself: no navigating away, no pop-ups, no webviews.
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${APP_ORIGIN}/`)) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.on('closed', () => {
    window = null;
  });
  return win;
}

function loadApp() {
  return window?.loadURL(`${APP_ORIGIN}/`);
}

/** Only the app's own pages may use the bridge. */
function assertFromApp(event: IpcMainInvokeEvent) {
  if (!event.senderFrame?.url.startsWith(`${APP_ORIGIN}/`)) {
    throw new Error('Not allowed');
  }
}

/** Online mode: a server that needs a newer app makes the app update before anything else. */
async function checkServerMinimum() {
  if (config.mode !== 'online' || !config.apiBaseUrl) return;
  try {
    const res = await fetch(`${config.apiBaseUrl}/meta`, { signal: AbortSignal.timeout(10_000) });
    const meta = (await res.json()) as { minClientVersion?: string | null };
    if (meta.minClientVersion) updates.require(meta.minClientVersion);
  } catch (error) {
    // No internet right now: requests will tell us (426) once it's back.
    log(`Couldn't ask the server for its minimum app version: ${describe(error)}`);
  }
}

/** Checks that an address is an online Point of Sale server. */
async function checkOnlineServer(raw: unknown) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    throw new Error('Enter the server address, for example https://pos.example.com');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('The server address must start with https://');
  }
  const base = `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  let meta: { mode?: string; minClientVersion?: string | null };
  try {
    const res = await fetch(`${base}/meta`, { signal: AbortSignal.timeout(10_000) });
    meta = (await res.json()) as typeof meta;
  } catch {
    throw new Error(`Couldn't reach ${base}. Check the address and your internet connection.`);
  }
  if (meta.mode !== 'online') {
    throw new Error("That address isn't an online Point of Sale server.");
  }
  // A newer app needed: connect anyway; the app then updates itself before it can be used.
  if (meta.minClientVersion && olderThan(app.getVersion(), meta.minClientVersion)) {
    setImmediate(() => updates.require(meta.minClientVersion as string));
  }
  return base;
}

ipcMain.on('pos:get-config', (event) => {
  event.returnValue = { config: { mode: config.mode, apiBaseUrl: currentApiBaseUrl() }, version: app.getVersion() };
});

ipcMain.handle('pos:choose-mode', async (event, choice: { mode?: unknown; apiBaseUrl?: unknown }) => {
  assertFromApp(event);
  if (config.mode) {
    throw new Error('This computer is already set up.');
  }
  if (choice?.mode === 'offline') {
    try {
      await startOffline();
    } catch (error) {
      await stopOffline();
      throw new Error(describe(error));
    }
    config = { ...config, mode: 'offline' };
  } else if (choice?.mode === 'online') {
    config = { ...config, mode: 'online', apiBaseUrl: await checkOnlineServer(choice.apiBaseUrl) };
  } else {
    throw new Error('Choose a business type');
  }
  saveConfig(config);
  log(`Mode set to ${config.mode}`);
  // After this call returns, so the page's promise settles before it is replaced.
  setImmediate(() => void loadApp());
});

/**
 * Backups are for admins: the page passes its sign-in token and the local API says whose
 * it is. The bridge can't trust the page's own idea of the role.
 */
async function assertAdmin(token: unknown) {
  if (config.mode !== 'offline' || !api) throw new Error('Backups are only for businesses on this computer');
  if (typeof token !== 'string' || !token) throw new Error('Sign in as an admin first');
  const res = await fetch(`${api.baseUrl}/auth/me`, { headers: { authorization: `Bearer ${token}` } });
  const me = res.ok ? ((await res.json()) as { role?: string }) : null;
  if (me?.role !== 'ADMIN') throw new Error('Only an admin can manage backups');
}

ipcMain.handle('pos:backups:list', async (event, token: unknown) => {
  assertFromApp(event);
  await assertAdmin(token);
  return { days: config.backupDays, folder: backupsFolder(), backups: await backups.list() };
});

ipcMain.handle('pos:backups:set-days', async (event, token: unknown, days: unknown) => {
  assertFromApp(event);
  await assertAdmin(token);
  config = { ...config, backupDays: clampBackupDays(days) };
  saveConfig(config);
  await backups.prune();
  return config.backupDays;
});

ipcMain.handle('pos:backups:create', async (event, token: unknown) => {
  assertFromApp(event);
  await assertAdmin(token);
  await backups.create('manual');
});

ipcMain.handle('pos:backups:restore', async (event, token: unknown, file: unknown) => {
  assertFromApp(event);
  await assertAdmin(token);
  if (typeof file !== 'string') throw new Error('Choose a backup');
  log(`Restoring ${file}`);
  await backups.restore(file, { stopApi, startApi });
  log(`Restored ${file}`);
  // The API has a new port and the signed-in session may not exist in the restored data:
  // start again from the sign-in screen.
  setImmediate(() => {
    void window?.webContents
      .executeJavaScript("localStorage.removeItem('pos_session')")
      .finally(() => void loadApp());
  });
});

ipcMain.handle('pos:backups:open-folder', async (event, token: unknown) => {
  assertFromApp(event);
  await assertAdmin(token);
  await shell.openPath(backupsFolder());
});

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

ipcMain.handle('pos:open-logs', async (event) => {
  assertFromApp(event);
  await shell.openPath(paths.logs());
});

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
    serveWebApp(currentApiOrigin);
    window = createWindow();
    await window.loadURL(LOADING_PAGE);
    try {
      if (config.mode === 'offline') await startOffline();
      await loadApp();
    } catch (error) {
      await showStartupError(error);
      return;
    }
    updates.start();
    void checkServerMinimum();
  });

  app.on('window-all-closed', () => app.quit());

  // Stop the API and the database cleanly before exiting.
  app.on('before-quit', (event) => {
    if (stopped) return;
    event.preventDefault();
    if (stopping) return;
    stopping = true;
    void stopOffline()
      .catch((error) => log(`Shutdown problem: ${describe(error)}`))
      .finally(() => {
        stopped = true;
        app.quit();
      });
  });
}
