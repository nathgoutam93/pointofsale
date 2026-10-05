import { ipcMain } from 'electron';
import { saveConfig } from './config.js';
import { currentApiBaseUrl, currentApiOrigin } from './fallback-counter.js';
import { assertAdminOfCurrentApi, assertFromApp } from './ipc-access.js';
import { logger } from './log.js';
import { cleanPrintingSettings, cleanReceiptJob, listPrinters, ReceiptPrinter } from './printing.js';
import { PAGE_API_BASE } from './protocol.js';
import { config, setConfig } from './state.js';
import { window } from './window.js';

const log = logger('main');
const receiptPrinter = new ReceiptPrinter(logger('printing'), () => currentApiOrigin());

export function registerPrintingHandlers() {
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
    setConfig({ ...config, printing });
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
}
