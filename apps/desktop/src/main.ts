import { app, BrowserWindow, dialog, ipcMain, net, session, shell, type IpcMainInvokeEvent } from 'electron';
import { LocalApi, runMigrations } from './api-server.js';
import { crashDetails, CrashReports } from './crash-reports.js';
import { Backups, backupsFolder } from './backups.js';
import { emailCodeRequest, moveOnline, type MoveInput } from './move-online.js';
import { randomBytes, randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { writeFile } from 'fs/promises';
import { FallbackCounter } from './fallback.js';
import { join } from 'path';
import { clampBackupDays, cleanHosting, loadConfig, saveConfig, withOfflineSecrets, type DesktopConfig } from './config.js';
import { logger } from './log.js';
import { paths } from './paths.js';
import { describe, LocalPostgres } from './postgres.js';
import { cleanPrintingSettings, cleanReceiptJob, listPrinters, ReceiptPrinter } from './printing.js';
import { APP_ORIGIN, PAGE_API_BASE, registerAppScheme, serveWebApp, type ApiTarget } from './protocol.js';
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
  () => config.backupDays,
  {
    folder: () => config.backupCopyFolder,
    record: (status) => {
      config = { ...config, backupCopyStatus: { ...status, at: new Date().toISOString() } };
      saveConfig(config);
    }
  }
);
const receiptPrinter = new ReceiptPrinter(logger('printing'), () => currentApiOrigin());
let stopping = false;

/**
 * Crashes of this app, its local API and its screens: kept on this computer and, once an admin
 * says yes, sent to the online server (this business's, or the hosted one for an offline install).
 */
const crashes = new CrashReports(logger('crash-reports'), () => ({
  enabled: config.crashReports,
  server: config.mode === 'online' ? config.apiBaseUrl : defaultServerUrl,
  mode: config.mode === 'online' ? (config.fallback?.active ? 'fallback' : 'online') : 'offline',
  installId: config.deviceId
}));
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

/**
 * The hosted server this build signs up and moves businesses to: `posServerUrl` in the
 * app's package.json (POS_SERVER_URL overrides it). Empty: people type the address.
 */
const defaultServerUrl = (() => {
  if (process.env.POS_SERVER_URL) return process.env.POS_SERVER_URL;
  try {
    const manifest = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')) as { posServerUrl?: string };
    return manifest.posServerUrl || null;
  } catch {
    return null;
  }
})();

// This computer's id, made once: a fallback counter opens only on its own computer.
if (!config.deviceId) {
  config = { ...config, deviceId: randomUUID() };
  saveConfig(config);
}

/** Online: this computer as its branch's fallback counter (selling while the server is down). */
const fallback = new FallbackCounter(
  logger('fallback'),
  () => (config.mode === 'online' ? config.fallback : null),
  (next) => {
    config = { ...config, fallback: next };
    saveConfig(config);
    notifyFallback();
  },
  () => paths.postgresHome()
);
let fallbackTimers: NodeJS.Timeout[] = [];
const FALLBACK_REFRESH_MS = 10 * 60 * 1000;
const FALLBACK_PROBE_MS = 30 * 1000;

function notifyFallback() {
  window?.webContents.send('pos:fallback-status', fallback.status());
}

/**
 * The API the web app talks to: the local one offline, the hosted one online, or the fallback
 * counter's local copy while it sells without the server.
 */
function currentApiBaseUrl() {
  if (config.mode === 'offline') return api?.port ? api.baseUrl : null;
  if (config.mode === 'online') return config.fallback?.active ? fallback.baseUrl : config.apiBaseUrl;
  return null;
}

/**
 * An invoice or return the server just numbered through this computer. A fallback counter's
 * series are only ever issued here, so the last one seen is the series' last: offline ones
 * carry on after it.
 */
function noteInvoiceIssued(invoiceNo: string) {
  const settings = config.fallback;
  if (config.mode !== 'online' || !settings || settings.active) return;
  const at = invoiceNo.lastIndexOf('/');
  const prefix = invoiceNo.slice(0, at);
  const seq = Number(invoiceNo.slice(at + 1));
  if (at <= 0 || !Number.isInteger(seq) || (settings.issued?.[prefix] ?? 0) >= seq) return;
  config = { ...config, fallback: { ...settings, issued: { ...settings.issued, [prefix]: seq } } };
  saveConfig(config);
}

/** Where the page's requests go right now. */
function apiTarget(): ApiTarget {
  if (config.mode === 'online' && fallback.syncing) {
    return { base: null, unavailable: 'Sending the offline sales to the server. Try again in a moment.' };
  }
  return { base: currentApiBaseUrl() };
}

/**
 * Whether the online server answers, as the page's requests find out; the banner follows it.
 * A register opened or closed on the fallback counter refreshes its copy, so the copy has the
 * register that is open if the server goes down next.
 */
function onServerAnswer(base: string, reachable: boolean, request: { method: string; path: string; status: number }) {
  if (config.mode !== 'online' || base !== config.apiBaseUrl) return;
  if (
    config.fallback &&
    request.method === 'POST' &&
    (request.path === '/registers/open' || request.path === '/registers/close') &&
    request.status === 200
  ) {
    void fallback.refresh().then(() => notifyFallback());
  }
  if (fallback.serverReachable === reachable) return;
  fallback.serverReachable = reachable;
  log(reachable ? 'The server answers again' : "Can't reach the server");
  notifyFallback();
}

/**
 * Online: whether the server answers, checked every 30 seconds in the background, so the banner
 * (and the fallback counter's offer to keep selling) shows before a sale fails, and the offer to
 * send offline sales shows once the server is back.
 */
async function probeServer() {
  if (config.mode !== 'online' || !config.apiBaseUrl) return;
  let reachable: boolean;
  try {
    const res = await net.fetch(`${config.apiBaseUrl}/meta`, { signal: AbortSignal.timeout(5_000) });
    reachable = res.ok;
  } catch {
    reachable = false;
  }
  if (config.mode !== 'online' || fallback.serverReachable === reachable) return;
  fallback.serverReachable = reachable;
  log(reachable ? 'The server answers again' : "Can't reach the server");
  notifyFallback();
}

/**
 * The fallback counter at startup: its local copy running (before the page, if it is selling
 * from it) and refreshed every 10 minutes while online.
 */
async function startFallback(options: { refreshNow?: boolean } = {}) {
  for (const timer of fallbackTimers) clearInterval(timer);
  fallbackTimers = [];
  if (config.mode !== 'online' || !config.fallback) return;
  if (config.fallback.active) {
    await fallback.start().catch((error) => log(`The offline copy didn't start: ${describe(error)}`));
  } else if (options.refreshNow !== false) {
    void fallback
      .start()
      .then(() => fallback.refresh())
      .then(() => notifyFallback())
      .catch((error) => log(`The offline copy didn't start: ${describe(error)}`));
  }
  fallbackTimers.push(
    setInterval(() => {
      if (!config.fallback?.active) void fallback.refresh().then(() => notifyFallback());
    }, FALLBACK_REFRESH_MS)
  );
}

/**
 * A request to the API with this app's sign-in cookie (the page's, kept in the app's cookie
 * store). The cookie-session header is what lets the API read it.
 */
function sessionFetch(url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('x-pos-session', 'cookie');
  headers.set('x-pos-client-version', app.getVersion());
  return net.fetch(url, { ...init, headers });
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
  if (await switchIfMoved()) return;
  backupTimer = setInterval(() => {
    void backups
      .daily()
      .then(() => {
        // The second folder was unavailable last time (USB drive unplugged): try again.
        if (config.backupCopyFolder && config.backupCopyStatus && !config.backupCopyStatus.ok) return backups.copyLatest();
      })
      .catch((error) => log(`Daily backup failed: ${describe(error)}`));
  }, HOUR_MS);
  backupTimer.unref();
}

/**
 * The business already moved online (the app stopped right after the move, before switching):
 * switch now. Returns true when it did.
 */
async function switchIfMoved() {
  if (!api) return false;
  try {
    const meta = (await (await fetch(`${api.baseUrl}/meta`)).json()) as { movedTo?: { server: string } | null };
    if (!meta.movedTo) return false;
    log(`This business moved online to ${meta.movedTo.server}; switching`);
    await switchToOnline(meta.movedTo.server);
    return true;
  } catch (error) {
    log(`Couldn't check whether the business moved: ${describe(error)}`);
    return false;
  }
}

/** From now on this computer uses the online business; the local data stays as a read-only copy. */
async function switchToOnline(server: string) {
  const localBase = api?.baseUrl ?? null;
  config = { ...config, mode: 'online', apiBaseUrl: server, hosting: null, pendingImportId: null };
  saveConfig(config);
  await checkServerDetails();
  await stopOffline();
  // The sign-in to the local API is of no more use; the online server sets its own.
  if (localBase) await session.defaultSession.cookies.remove(localBase, 'pos_session').catch(() => undefined);
}

/** Migrations, then the API. Also used to bring the API back after a restore. */
async function startApi() {
  if (!postgres) throw new Error('The database is not running');
  log('Applying migrations');
  await runMigrations(postgres.databaseUrl, logger('migrations'));
  log('Migrations done; starting the API');
  api = new LocalApi(logger('api'), (detail) => {
    log(detail);
    // Its last lines may quote data: only the exit code and stack frames go in the report.
    crashes.report('local-api', { message: detail.split(':')[0] ?? 'The API stopped', stack: (detail.match(/at [^()\s]+ \([^)]+\)/g) ?? []).join('\n') });
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

/**
 * Online mode, at launch and on connecting: what the server says about itself. One that needs a
 * newer app makes the app update before anything else; whether it is our managed service or a
 * business's own server is kept for when it can't be reached.
 */
async function checkServerDetails() {
  if (config.mode !== 'online' || !config.apiBaseUrl) return;
  const server = config.apiBaseUrl;
  try {
    const res = await fetch(`${server}/meta`, { signal: AbortSignal.timeout(10_000) });
    const meta = (await res.json()) as { minClientVersion?: string | null; hosting?: unknown };
    if (meta.minClientVersion) updates.require(meta.minClientVersion);
    // A server older than this setting doesn't say; leave what was known.
    const hosting = cleanHosting(meta.hosting);
    if (hosting && config.apiBaseUrl === server && config.hosting !== hosting) {
      config = { ...config, hosting };
      saveConfig(config);
    }
  } catch (error) {
    // No internet right now: requests will tell us (426) once it's back.
    log(`Couldn't ask the server about itself: ${describe(error)}`);
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
  event.returnValue = {
    // The page reaches the API through this app (see PAGE_API_BASE), never directly.
    config: {
      mode: config.mode,
      apiBaseUrl: config.mode ? PAGE_API_BASE : null,
      defaultServerUrl,
      deviceId: config.deviceId,
      hosting: config.mode === 'online' ? config.hosting : null
    },
    version: app.getVersion()
  };
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
    config = { ...config, mode: 'online', apiBaseUrl: await checkOnlineServer(choice.apiBaseUrl), hosting: null };
    await checkServerDetails();
  } else {
    throw new Error('Choose a business type');
  }
  saveConfig(config);
  log(`Mode set to ${config.mode}`);
  // After this call returns, so the page's promise settles before it is replaced.
  setImmediate(() => void loadApp());
});

/**
 * Backups and moving online are for admins: the API says who is signed in here (by the
 * sign-in cookie). The bridge can't trust the page's own idea of the role.
 */
async function assertAdmin() {
  if (config.mode !== 'offline' || !api) throw new Error('Only for a business kept on this computer');
  await assertAdminOfCurrentApi();
}

/** As above, against whichever API this window works with (the local one, or the server online). */
async function assertAdminOfCurrentApi() {
  const base = currentApiBaseUrl();
  if (!base) throw new Error('Set up this computer first');
  let res: Response;
  try {
    res = await sessionFetch(`${base}/auth/me`, { signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new Error("Couldn't reach the server to check you're an admin. Check the internet connection.");
  }
  if (res.status === 401) throw new Error('Your session has ended. Sign in again, then try once more.');
  const me = res.ok ? ((await res.json()) as { role?: string }) : null;
  if (me?.role !== 'ADMIN') throw new Error('Only an admin can do this');
}

ipcMain.handle('pos:backups:list', async (event) => {
  assertFromApp(event);
  await assertAdmin();
  return {
    days: config.backupDays,
    folder: backupsFolder(),
    copyFolder: config.backupCopyFolder,
    copyStatus: config.backupCopyStatus,
    backups: await backups.list()
  };
});

ipcMain.handle('pos:backups:set-days', async (event, days: unknown) => {
  assertFromApp(event);
  await assertAdmin();
  config = { ...config, backupDays: clampBackupDays(days) };
  saveConfig(config);
  await backups.prune();
  return config.backupDays;
});

ipcMain.handle('pos:backups:create', async (event) => {
  assertFromApp(event);
  await assertAdmin();
  await backups.create('manual');
});

ipcMain.handle('pos:backups:restore', async (event, file: unknown) => {
  assertFromApp(event);
  await assertAdmin();
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

/** A second folder for copies of every backup: a USB drive or a folder a cloud service syncs. */
ipcMain.handle('pos:backups:choose-copy-folder', async (event) => {
  assertFromApp(event);
  await assertAdmin();
  const picked = await dialog.showOpenDialog({
    title: 'Choose where to keep copies of the backups',
    buttonLabel: 'Copy backups here',
    properties: ['openDirectory', 'createDirectory']
  });
  const folder = picked.filePaths[0];
  if (picked.canceled || !folder) return { copyFolder: config.backupCopyFolder, copyStatus: config.backupCopyStatus };
  if (folder === backupsFolder()) throw new Error("That's where the backups already are; choose another drive or folder");
  config = { ...config, backupCopyFolder: folder, backupCopyStatus: null };
  saveConfig(config);
  log(`Backups will also be copied to ${folder}`);
  await backups.copyLatest();
  return { copyFolder: config.backupCopyFolder, copyStatus: config.backupCopyStatus };
});

ipcMain.handle('pos:backups:stop-copying', async (event) => {
  assertFromApp(event);
  await assertAdmin();
  config = { ...config, backupCopyFolder: null, backupCopyStatus: null };
  saveConfig(config);
});

ipcMain.handle('pos:backups:open-folder', async (event) => {
  assertFromApp(event);
  await assertAdmin();
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

/** This computer's receipt printer settings; any signed-in page may read them (the POS needs them). */
ipcMain.handle('pos:printing:settings', (event) => {
  assertFromApp(event);
  return config.printing;
});

ipcMain.handle('pos:printing:printers', async (event) => {
  assertFromApp(event);
  if (!window) return [];
  return listPrinters(window.webContents);
});

ipcMain.handle('pos:printing:save', async (event, raw: unknown) => {
  assertFromApp(event);
  await assertAdminOfCurrentApi();
  const printing = cleanPrintingSettings(raw);
  if (printing.printerName && window) {
    const printers = await listPrinters(window.webContents);
    if (!printers.some((printer) => printer.name === printing.printerName)) {
      throw new Error(`"${printing.printerName}" isn't installed on this computer`);
    }
  }
  config = { ...config, printing };
  saveConfig(config);
  log(`Receipt printing: ${printing.printerName ?? 'system dialog'}, auto-print ${printing.autoPrint}, drawer ${printing.openDrawer ? `pin ${printing.drawerPin}` : 'off'}`);
  return printing;
});

/** Prints the receipt the page shows straight to the receipt printer, without a dialog. */
ipcMain.handle('pos:printing:print-receipt', async (event, job: unknown) => {
  assertFromApp(event);
  const { printerName } = config.printing;
  if (!printerName) throw new Error('No receipt printer is set up on this computer');
  const cleaned = cleanReceiptJob(job);
  // The page's images (the logo) point at app://pos/api; the print window loads them directly.
  const base = currentApiBaseUrl();
  if (base) cleaned.markup = cleaned.markup.replaceAll(`${PAGE_API_BASE}/`, `${base}/`);
  await receiptPrinter.print(printerName, cleaned);
});

/** After cash is taken or refunded. Does nothing unless the drawer is switched on in Settings. */
ipcMain.handle('pos:printing:open-drawer', async (event) => {
  assertFromApp(event);
  const { printerName, openDrawer, drawerPin } = config.printing;
  if (!printerName || !openDrawer) return false;
  await receiptPrinter.openDrawer(printerName, drawerPin);
  return true;
});

/** Settings → Printer: opens the drawer to check it's wired up, whether or not it's switched on. */
ipcMain.handle('pos:printing:test-drawer', async (event) => {
  assertFromApp(event);
  await assertAdminOfCurrentApi();
  const { printerName, drawerPin } = config.printing;
  if (!printerName) throw new Error('Choose the receipt printer first');
  await receiptPrinter.openDrawer(printerName, drawerPin);
});

/** Checks an address (or the built-in one) is an online server; answers it tidied. */
ipcMain.handle('pos:check-server', async (event, address: unknown) => {
  assertFromApp(event);
  return checkOnlineServer(typeof address === 'string' && address.trim() ? address : defaultServerUrl);
});

/**
 * First launch, "Create an online business": sent from here, not the page, whose security
 * policy only lets it reach the server it works with (none yet). Answers the new business,
 * its admin's session and the server; the page then switches to online mode.
 */
ipcMain.handle('pos:create-business', async (event, address: unknown, details: Record<string, unknown>) => {
  assertFromApp(event);
  if (config.mode) throw new Error('This computer is already set up.');
  const server = await checkOnlineServer(typeof address === 'string' && address.trim() ? address : defaultServerUrl);
  // With the app's cookie store: the new admin's sign-in becomes the cookie for that server.
  const res = await sessionFetch(`${server}/businesses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(details ?? {}),
    signal: AbortSignal.timeout(120_000)
  });
  // The owner's email isn't verified yet: a code was emailed; the page asks for it.
  const codeMessage = await emailCodeRequest(res);
  if (codeMessage) return { emailCodeRequired: true, message: codeMessage };
  const body = (await res.json().catch(() => null)) as { message?: unknown; business?: unknown; session?: unknown } | null;
  if (res.status !== 201 || !body) {
    const message = Array.isArray(body?.message) ? body.message.join(', ') : body?.message;
    throw new Error(typeof message === 'string' ? message : "The business couldn't be created. Check the details and try again.");
  }
  return { server, business: body.business, session: body.session };
});

/**
 * A forgotten owner password: asks the server to email a code ("request"), then sends the code
 * and the new password ("confirm"). From here, like creating a business, because the page may
 * not be allowed to reach that server (first launch, or offline). The server is the one given,
 * else this computer's online server, else the built-in one.
 */
const OWNER_RESET_PATHS: Record<string, string> = {
  request: '/accounts/password-reset',
  confirm: '/accounts/password-reset/confirm'
};
ipcMain.handle('pos:owner-password-reset', async (event, address: unknown, step: unknown, details: unknown) => {
  assertFromApp(event);
  const path = typeof step === 'string' ? OWNER_RESET_PATHS[step] : undefined;
  if (!path) throw new Error('Unknown step');
  const fallback = config.mode === 'online' ? currentApiBaseUrl() : defaultServerUrl;
  const server = await checkOnlineServer(typeof address === 'string' && address.trim() ? address : fallback);
  const res = await fetch(`${server}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-pos-client-version': app.getVersion() },
    body: JSON.stringify(details && typeof details === 'object' ? details : {}),
    signal: AbortSignal.timeout(30_000)
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
    const message = Array.isArray(body?.message) ? body.message.join(', ') : body?.message;
    throw new Error(typeof message === 'string' ? message : "That didn't work. Try again in a moment.");
  }
  return { server };
});

/**
 * First launch: "Restore from a backup". The person picks a backup file (made by this app on
 * any computer); the business is restored here in offline mode, then the app reloads at the
 * sign-in screen. A backup older than this version is brought up to date by the migrations.
 */
ipcMain.handle('pos:restore-from-backup', async (event) => {
  assertFromApp(event);
  if (config.mode) throw new Error('This computer is already set up.');
  const picked = await dialog.showOpenDialog({
    title: 'Choose a Point of Sale backup',
    buttonLabel: 'Restore',
    properties: ['openFile'],
    filters: [{ name: 'Point of Sale backups', extensions: ['zip'] }]
  });
  const file = picked.filePaths[0];
  if (picked.canceled || !file) return { restored: false };
  log(`Restoring a new computer from ${file}`);
  try {
    await startOffline();
    await backups.restoreFile(file, { stopApi, startApi });
  } catch (error) {
    // Leaves the computer as it was: no mode chosen, so the welcome screen comes back.
    await stopOffline();
    throw new Error(describe(error));
  }
  config = { ...config, mode: 'offline' };
  saveConfig(config);
  // A business that had already moved online: work with it online instead.
  await switchIfMoved();
  setImmediate(() => void loadApp());
  return { restored: true };
});

/** Offline, admins: the whole move online. Progress goes to the page as 'pos:move-online-progress'. */
ipcMain.handle('pos:move-online', async (event, input: Partial<MoveInput>) => {
  assertFromApp(event);
  await assertAdmin();
  const result = await moveOnline(
    {
      server: typeof input?.server === 'string' && input.server.trim() ? input.server : defaultServerUrl ?? '',
      ownerEmail: String(input?.ownerEmail ?? ''),
      ownerPassword: String(input?.ownerPassword ?? ''),
      emailCode: typeof input?.emailCode === 'string' && input.emailCode.trim() ? input.emailCode.trim() : undefined
    },
    {
      log: logger('move-online'),
      localApi: () => {
        if (!api) throw new Error('The local service is not running');
        return api.baseUrl;
      },
      localFetch: sessionFetch,
      checkServer: (address) => checkOnlineServer(address),
      backup: () => backups.create('before-move'),
      importId: () => config.pendingImportId,
      saveImportId: (id) => {
        config = { ...config, pendingImportId: id };
        saveConfig(config);
      },
      onUpdateNeeded: () => void updates.check(),
      progress: (step) => event.sender.send('pos:move-online-progress', step)
    }
  );
  if (!result.emailCodeRequired) await switchToOnline(result.server);
  return result;
});

/** Online: whether this computer is its branch's fallback counter, and how that stands. */
ipcMain.handle('pos:fallback:status', (event) => {
  assertFromApp(event);
  return fallback.status();
});

/**
 * Online, admins, on this computer: makes `counterId` the branch's fallback counter here. The
 * server binds it to this computer and answers its key; the local copy is then made at once.
 */
ipcMain.handle('pos:fallback:setup', async (event, counterId: unknown) => {
  assertFromApp(event);
  if (config.mode !== 'online' || !config.apiBaseUrl) throw new Error('Only for online businesses');
  if (typeof counterId !== 'string' || !/^[0-9a-f-]{36}$/.test(counterId)) throw new Error('Choose a counter');
  if (config.fallback?.pendingSync) throw new Error('Send the offline sales to the server first.');
  await assertAdminOfCurrentApi();
  const res = await sessionFetch(`${config.apiBaseUrl}/counters/${counterId}/fallback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId: config.deviceId }),
    signal: AbortSignal.timeout(30_000)
  });
  const body = (await res.json().catch(() => null)) as { key?: string; counter?: { id: string; name: string; branchId: string }; message?: unknown } | null;
  if (!res.ok || !body?.key || !body.counter) {
    throw new Error(typeof body?.message === 'string' ? body.message : "The server didn't set up the fallback counter");
  }
  if (config.fallback) await fallback.remove();
  config = {
    ...config,
    fallback: {
      counterId: body.counter.id,
      counterName: body.counter.name,
      branchId: body.counter.branchId,
      server: config.apiBaseUrl,
      key: body.key,
      localSecret: randomBytes(32).toString('base64url'),
      authSecret: randomBytes(48).toString('base64url'),
      dbPassword: randomBytes(24).toString('hex'),
      refreshedAt: null,
      active: false,
      pendingSync: false
    }
  };
  saveConfig(config);
  log(`This computer is now the fallback counter for ${body.counter.name}`);
  await fallback.start();
  await fallback.refresh();
  await startFallback({ refreshNow: false });
  notifyFallback();
  return fallback.status();
});

/** Online, admins: this computer is an ordinary till again; its local copy is deleted. */
ipcMain.handle('pos:fallback:remove', async (event) => {
  assertFromApp(event);
  const settings = config.fallback;
  if (!settings) return fallback.status();
  if (settings.pendingSync) throw new Error('Send the offline sales to the server first.');
  await assertAdminOfCurrentApi();
  const res = await sessionFetch(`${settings.server}/counters/${settings.counterId}/fallback`, { method: 'DELETE', signal: AbortSignal.timeout(30_000) });
  if (!res.ok && res.status !== 404) {
    const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
    throw new Error(typeof body?.message === 'string' ? body.message : "The server didn't take the change");
  }
  for (const timer of fallbackTimers) clearInterval(timer);
  fallbackTimers = [];
  await fallback.remove();
  config = { ...config, fallback: null };
  saveConfig(config);
  log('This computer is no longer a fallback counter');
  notifyFallback();
  return fallback.status();
});

/** The server can't be reached: sell from the local copy. Staff sign in again (on the copy). */
ipcMain.handle('pos:fallback:start', async (event) => {
  assertFromApp(event);
  const settings = config.fallback;
  if (config.mode !== 'online' || !settings) throw new Error('This computer is not a fallback counter');
  if (!settings.refreshedAt) throw new Error("The offline copy isn't ready yet");
  if (!settings.active) {
    await fallback.start();
    await fallback.catchUpNumbers();
    config = { ...config, fallback: { ...settings, active: true, pendingSync: true } };
    saveConfig(config);
    log(`Selling offline on ${settings.counterName}`);
  }
  notifyFallback();
  setImmediate(() => void loadApp());
  return fallback.status();
});

/**
 * The server is back: send everything sold offline, then work with the server again. While
 * sending, the page's requests wait; if it fails, selling carries on offline.
 */
ipcMain.handle('pos:fallback:finish', async (event) => {
  assertFromApp(event);
  const settings = config.fallback;
  if (!settings?.active && !settings?.pendingSync) return fallback.status();
  fallback.syncing = true;
  notifyFallback();
  try {
    const sent = await fallback.sync();
    log(`Sent the offline sales: ${sent.invoices} new invoices, ${sent.returns ?? 0} returns, ${sent.customers ?? 0} new customers, ${sent.registers} registers`);
    config = { ...config, fallback: { ...(config.fallback as typeof settings), active: false, pendingSync: false } };
    saveConfig(config);
    fallback.error = null;
    fallback.serverReachable = true;
  } catch (error) {
    fallback.error = describe(error);
    log(`Sending the offline sales failed: ${fallback.error}`);
    throw new Error(`${fallback.error}. The sales are still on this computer; selling carries on offline.`);
  } finally {
    fallback.syncing = false;
    notifyFallback();
  }
  setImmediate(() => {
    void loadApp();
    void fallback.refresh().then(() => notifyFallback());
  });
  return fallback.status();
});

/**
 * The offline sales, saved to a file the person picks: for support when the server refuses them
 * (they also stay on this computer).
 */
ipcMain.handle('pos:fallback:save-outbox', async (event) => {
  assertFromApp(event);
  const settings = config.fallback;
  if (config.mode !== 'online' || !settings) throw new Error('This computer is not a fallback counter');
  const day = new Date().toISOString().slice(0, 10);
  const picked = await dialog.showSaveDialog({
    title: 'Save the offline sales',
    defaultPath: `offline-sales-${settings.counterName.replace(/[^A-Za-z0-9-]+/g, '-')}-${day}.json`,
    filters: [{ name: 'Offline sales', extensions: ['json'] }]
  });
  if (picked.canceled || !picked.filePath) return { saved: false };
  await writeFile(picked.filePath, await fallback.outbox(), { mode: 0o600 });
  log(`Saved the offline sales to ${picked.filePath}`);
  return { saved: true };
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
  config = { ...config, crashReports: enabled };
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
    window = createWindow();
    await window.loadURL(LOADING_PAGE);
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
