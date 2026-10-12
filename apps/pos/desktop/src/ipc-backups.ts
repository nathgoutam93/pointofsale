import { dialog, ipcMain, shell } from 'electron';
import { backupsFolder } from './backups.js';
import { clampBackupDays, saveConfig } from './config.js';
import { assertAdmin, assertFromApp } from './ipc-access.js';
import { logger } from './log.js';
import { backups, startApi, stopApi } from './services.js';
import { config, setConfig } from './state.js';
import { loadApp, window } from './window.js';

const log = logger('main');

export function registerBackupHandlers() {
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
    setConfig({ ...config, backupDays: clampBackupDays(days) });
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
    setConfig({ ...config, backupCopyFolder: folder, backupCopyStatus: null });
    saveConfig(config);
    log(`Backups will also be copied to ${folder}`);
    await backups.copyLatest();
    return { copyFolder: config.backupCopyFolder, copyStatus: config.backupCopyStatus };
  });

  ipcMain.handle('pos:backups:stop-copying', async (event) => {
    assertFromApp(event);
    await assertAdmin();
    setConfig({ ...config, backupCopyFolder: null, backupCopyStatus: null });
    saveConfig(config);
  });

  ipcMain.handle('pos:backups:open-folder', async (event) => {
    assertFromApp(event);
    await assertAdmin();
    await shell.openPath(backupsFolder());
  });
}
