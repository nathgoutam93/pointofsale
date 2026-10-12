import { dialog, ipcMain } from 'electron';
import { randomBytes } from 'crypto';
import { writeFile } from 'fs/promises';
import { saveConfig } from './config.js';
import { fallback, fallbackTimers, notifyFallback, setFallbackTimers, startFallback } from './fallback-counter.js';
import { assertAdminOfCurrentApi, assertFromApp } from './ipc-access.js';
import { logger } from './log.js';
import { describe } from './postgres.js';
import { sessionFetch } from './services.js';
import { config, setConfig } from './state.js';
import { loadApp } from './window.js';

const log = logger('main');

export function registerFallbackHandlers() {
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
    setConfig({
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
    });
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
    setFallbackTimers([]);
    await fallback.remove();
    setConfig({ ...config, fallback: null });
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
      setConfig({ ...config, fallback: { ...settings, active: true, pendingSync: true } });
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
      setConfig({ ...config, fallback: { ...(config.fallback as typeof settings), active: false, pendingSync: false } });
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
}
