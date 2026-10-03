// The only bridge between the web app and the desktop app. Runs sandboxed, so it can use
// just `contextBridge` and `ipcRenderer`; it never hands the page Node or Electron objects.
import { contextBridge, ipcRenderer } from 'electron';

type ModeChoice = { mode: 'offline' } | { mode: 'online'; apiBaseUrl: string };

// Read once: changing mode reloads the window, which runs this again.
const info = ipcRenderer.sendSync('pos:get-config') as {
  config: { mode: 'offline' | 'online' | null; apiBaseUrl: string | null };
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
  // Offline only, admins only (checked by the app against the local API with this token).
  backups: {
    list: (token: string) => invoke('pos:backups:list', token),
    setDays: (token: string, days: number) => invoke('pos:backups:set-days', token, days),
    create: (token: string) => invoke('pos:backups:create', token),
    restore: (token: string, file: string) => invoke('pos:backups:restore', token, file),
    openFolder: (token: string) => invoke('pos:backups:open-folder', token)
  }
});
