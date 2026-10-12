import { app, dialog, ipcMain } from 'electron';
import { saveConfig } from './config.js';
import { currentApiBaseUrl } from './fallback-counter.js';
import { assertAdmin, assertFromApp } from './ipc-access.js';
import { logger } from './log.js';
import { emailCodeRequest, moveOnline, type MoveInput } from './move-online.js';
import { describe } from './postgres.js';
import { PAGE_API_BASE } from './protocol.js';
import {
  api,
  backups,
  checkOnlineServer,
  checkServerDetails,
  sessionFetch,
  startApi,
  startOffline,
  stopApi,
  stopOffline,
  switchIfMoved,
  switchToOnline,
  updates
} from './services.js';
import { config, defaultServerUrl, setConfig } from './state.js';
import { loadApp } from './window.js';

const log = logger('main');

/** Setting this computer up: the business type, a new online business, a restore, moving online. */
export function registerSetupHandlers() {
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
      setConfig({ ...config, mode: 'offline' });
    } else if (choice?.mode === 'online') {
      setConfig({ ...config, mode: 'online', apiBaseUrl: await checkOnlineServer(choice.apiBaseUrl), hosting: null });
      await checkServerDetails();
    } else {
      throw new Error('Choose a business type');
    }
    saveConfig(config);
    log(`Mode set to ${config.mode}`);
    // After this call returns, so the page's promise settles before it is replaced.
    setImmediate(() => void loadApp());
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
    setConfig({ ...config, mode: 'offline' });
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
          setConfig({ ...config, pendingImportId: id });
          saveConfig(config);
        },
        onUpdateNeeded: () => void updates.check(),
        progress: (step) => event.sender.send('pos:move-online-progress', step)
      }
    );
    if (!result.emailCodeRequired) await switchToOnline(result.server);
    return result;
  });
}
