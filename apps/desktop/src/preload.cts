// The only bridge between the web app and the desktop app. Runs sandboxed, so it can use
// just `contextBridge` and `ipcRenderer`; it never hands the page Node or Electron objects.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

type ModeChoice = { mode: 'offline' } | { mode: 'online'; apiBaseUrl: string };

// Read once: changing mode reloads the window, which runs this again.
const info = ipcRenderer.sendSync('pos:get-config') as {
  config: { mode: 'offline' | 'online' | null; apiBaseUrl: string | null; defaultServerUrl: string | null };
  version: string;
};

/** IPC errors arrive as "Error invoking remote method '…': Error: <message>"; keep the message. */
async function invoke(channel: string, ...args: unknown[]) {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
  }
}

contextBridge.exposeInMainWorld('posDesktop', {
  config: info.config,
  version: info.version,
  chooseMode: (choice: ModeChoice) => invoke('pos:choose-mode', choice),
  openLogsFolder: () => invoke('pos:open-logs'),
  checkServer: (address: string) => invoke('pos:check-server', address),
  restoreFromBackup: () => invoke('pos:restore-from-backup'),
  createOnlineBusiness: (address: string, details: Record<string, unknown>) => invoke('pos:create-business', address, details),
  reload: () => invoke('pos:reload'),
  // A forgotten owner password: an emailed code, then the new password (see main.ts).
  ownerPasswordReset: (address: string, step: 'request' | 'confirm', details: Record<string, unknown>) =>
    invoke('pos:owner-password-reset', address, step, details),
  // Offline, admins only: moves the business to an online server (see apps/desktop/src/move-online.ts).
  moveOnline: (input: { server?: string; ownerEmail: string; ownerPassword: string }) => invoke('pos:move-online', input),
  onMoveOnlineProgress: (listener: (step: string) => void) => {
    const forward = (_event: IpcRendererEvent, step: string) => listener(step);
    ipcRenderer.on('pos:move-online-progress', forward);
    return () => ipcRenderer.removeListener('pos:move-online-progress', forward);
  },
  updates: {
    status: () => invoke('pos:updates:status'),
    check: () => invoke('pos:updates:check'),
    installNow: () => invoke('pos:updates:install'),
    require: (minimum: string) => invoke('pos:updates:require', minimum),
    /** Calls `listener` on every change; returns a function that stops it. */
    onStatus: (listener: (status: unknown) => void) => {
      const forward = (_event: IpcRendererEvent, status: unknown) => listener(status);
      ipcRenderer.on('pos:update-status', forward);
      return () => ipcRenderer.removeListener('pos:update-status', forward);
    }
  },
  // The receipt printer and cash drawer on this computer. Changing them needs an admin signed in.
  printing: {
    settings: () => invoke('pos:printing:settings'),
    printers: () => invoke('pos:printing:printers'),
    save: (settings: unknown) => invoke('pos:printing:save', settings),
    printReceipt: (job: { markup: string; css: string; columns: number; paperMm: 58 | 80 }) => invoke('pos:printing:print-receipt', job),
    openDrawer: () => invoke('pos:printing:open-drawer'),
    testDrawer: () => invoke('pos:printing:test-drawer')
  },
  // Offline only, admins only (the app asks the local API who is signed in).
  backups: {
    list: () => invoke('pos:backups:list'),
    setDays: (days: number) => invoke('pos:backups:set-days', days),
    create: () => invoke('pos:backups:create'),
    restore: (file: string) => invoke('pos:backups:restore', file),
    openFolder: () => invoke('pos:backups:open-folder'),
    chooseCopyFolder: () => invoke('pos:backups:choose-copy-folder'),
    stopCopying: () => invoke('pos:backups:stop-copying')
  }
});
