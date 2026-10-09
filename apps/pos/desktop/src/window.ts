import { app, BrowserWindow, dialog, shell } from 'electron';
import { logger } from './log.js';
import { paths } from './paths.js';
import { describe } from './postgres.js';
import { APP_ORIGIN } from './protocol.js';

const log = logger('main');
export let window: BrowserWindow | null = null;

export function setWindow(next: BrowserWindow | null) {
  window = next;
}

const htmlPage = (body: string) =>
  `data:text/html;charset=utf-8,${encodeURIComponent(
    `<!doctype html><meta charset="utf-8"><title>Point of Sale</title><body style="margin:0;display:grid;place-items:center;height:100vh;font:15px system-ui,sans-serif;color:#334155;background:#f8fafc">${body}</body>`
  )}`;

export const LOADING_PAGE = htmlPage('<p>Starting Point of Sale…</p>');

export async function showStartupError(error: unknown, detail?: string) {
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

export function createWindow() {
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

export function loadApp() {
  return window?.loadURL(`${APP_ORIGIN}/`);
}
