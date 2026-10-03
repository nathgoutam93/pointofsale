import { BrowserWindow, session, type WebContents } from 'electron';
import { spawn } from 'child_process';
import type { Logger } from './log.js';

export type DrawerPin = 2 | 5;

/** How this computer prints receipts. Saved in the app's config: printers belong to the computer. */
export type PrintingSettings = {
  /** The receipt printer receipts go straight to. null: every print opens the system dialog. */
  printerName: string | null;
  /** Print the receipt as soon as a sale is paid at the POS. */
  autoPrint: boolean;
  /** Open the cash drawer (plugged into the receipt printer) when cash is taken or refunded. */
  openDrawer: boolean;
  /** The drawer-kick pin of the printer's drawer port: almost always 2. */
  drawerPin: DrawerPin;
};

export const DEFAULT_PRINTING: PrintingSettings = { printerName: null, autoPrint: false, openDrawer: false, drawerPin: 2 };

/** Settings as saved or sent by the page, with anything unknown dropped. */
export function cleanPrintingSettings(raw: unknown): PrintingSettings {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const printerName = typeof value.printerName === 'string' && value.printerName.trim() ? value.printerName : null;
  return {
    printerName,
    // Both need a printer: the drawer is opened through it.
    autoPrint: !!printerName && value.autoPrint === true,
    openDrawer: !!printerName && value.openDrawer === true,
    drawerPin: value.drawerPin === 5 ? 5 : 2
  };
}

export type PrinterInfo = { name: string; displayName: string };

export async function listPrinters(contents: WebContents): Promise<PrinterInfo[]> {
  const printers = await contents.getPrintersAsync();
  return printers.map((printer) => ({
    name: printer.name,
    displayName: printer.displayName || printer.name
  }));
}

/** What the page sends: the receipt's own element and the CSS that styles it. */
export type ReceiptJob = {
  /** The outer HTML of #printable-invoice. */
  markup: string;
  /** The receipt template and the branch's sanitized CSS. */
  css: string;
  /** Characters per line, from the branch's receipt layout (32 to 64). */
  columns: number;
  /** The roll's width: 58 mm (2 inch) or 80 mm (3 inch). */
  paperMm: 58 | 80;
};

const MAX_JOB_CHARS = 1_000_000;

export function cleanReceiptJob(raw: unknown): ReceiptJob {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (typeof value.markup !== 'string' || !value.markup.includes('printable-invoice')) {
    throw new Error('Nothing to print');
  }
  const css = typeof value.css === 'string' ? value.css : '';
  if (value.markup.length + css.length > MAX_JOB_CHARS) throw new Error('This receipt is too large to print');
  const asked = Math.round(Number(value.columns));
  const columns = Number.isFinite(asked) && asked > 0 ? Math.min(Math.max(asked, 24), 96) : 48;
  // From before layouts, the page sent only the columns: 32 meant 58 mm paper.
  const paperMm = value.paperMm === 58 || value.paperMm === 80 ? value.paperMm : columns <= 32 ? 58 : 80;
  return { markup: value.markup, css, columns, paperMm };
}

const PX_PER_MM = 96 / 25.4;
/** A monospace character is 0.6 em wide (Courier New, and the Liberation Mono that stands in for it). */
const CHAR_EM = 0.6;

/** Roll width and the width the print head reaches, in mm. */
function paperFor(paperMm: 58 | 80) {
  return paperMm === 58 ? { paperMm, printableMm: 48 } : { paperMm, printableMm: 72 };
}

/**
 * The receipt as its own page: the paper's width, the text sized so a full line fills what
 * the print head reaches (on screen it is 12 px, wider than the paper), and nothing loaded
 * except the logo from the API.
 */
export function receiptDocument(job: ReceiptJob, apiOrigin: string | null) {
  const { printableMm } = paperFor(job.paperMm);
  const fontPx = Math.floor(((printableMm * PX_PER_MM) / (job.columns * CHAR_EM)) * 100) / 100;
  const csp = `default-src 'none'; style-src 'unsafe-inline'; img-src data:${apiOrigin ? ` ${apiOrigin}` : ''}`;
  // The CSS sits inside <style>: it can't be allowed to close it.
  const css = job.css.replace(/</g, '\\3c ');
  // The fitting rules get their own <style>, so a broken rule in the branch CSS can't swallow them.
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>Receipt</title><style>
${css}
</style><style>
@page { margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
body #printable-invoice { width: ${printableMm}mm !important; max-width: none !important; margin: 0 auto !important; padding: 0 0 6mm !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body #printable-invoice div.receipt-line { font-size: ${fontPx}px !important; }
body #printable-invoice div.receipt-line.receipt-large { font-size: ${fontPx * 2}px !important; line-height: 1.15 !important; }
body #printable-invoice svg.receipt-barcode { display: block !important; width: 100% !important; height: 12mm !important; margin: 2mm 0 1mm !important; }
body #printable-invoice img.receipt-logo { max-width: 100% !important; }
</style></head><body>${job.markup}</body></html>`;
}

const PRINT_PARTITION = 'pos-print';
const PRINT_TIMEOUT_MS = 30_000;

/** Electron's reasons are terse; say what the cashier can do about them. */
function printFailure(reason: string, printerName: string) {
  if (/invalid deviceName/i.test(reason)) {
    return new Error(`The receipt printer "${printerName}" isn't installed on this computer. Choose it again in Settings → Printer.`);
  }
  if (reason === 'cancelled') return new Error('Printing was cancelled');
  return new Error(`Couldn't print to "${printerName}". Check that it's on, connected and has paper.`);
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string) {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    })
  ]).finally(() => clearTimeout(timer));
}

/** The pulse a receipt printer sends down its drawer port: ESC p m t1 t2 (on 50 ms, off 500 ms). */
export function drawerPulse(pin: DrawerPin) {
  return Buffer.from([0x1b, 0x70, pin === 5 ? 1 : 0, 0x19, 0xfa]);
}

/**
 * Windows: bytes written to the printer as a RAW job through the spooler, so the driver passes
 * them through untouched. The printer name and data come in through the environment, never
 * the script text.
 */
const WINDOWS_RAW_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class PosRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DocInfo { public string DocName; public string OutputFile; public string DataType; }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern int StartDocPrinter(IntPtr handle, int level, [In] DocInfo info);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool WritePrinter(IntPtr handle, byte[] data, int count, out int written);
  public static void Send(string printer, byte[] data) {
    IntPtr handle;
    if (!OpenPrinter(printer, out handle, IntPtr.Zero)) throw new Win32Exception();
    try {
      if (StartDocPrinter(handle, 1, new DocInfo { DocName = "Open cash drawer", DataType = "RAW" }) == 0) throw new Win32Exception();
      try {
        StartPagePrinter(handle);
        int written;
        if (!WritePrinter(handle, data, data.Length, out written)) throw new Win32Exception();
        EndPagePrinter(handle);
      } finally { EndDocPrinter(handle); }
    } finally { ClosePrinter(handle); }
  }
}
'@
[PosRawPrinter]::Send($env:POS_PRINTER, [Convert]::FromBase64String($env:POS_DATA))
`;

function run(command: string, args: string[], options: { env?: NodeJS.ProcessEnv; input?: Buffer }) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { env: options.env ?? process.env, windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => child.kill(), 20_000);
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `${command} exited with ${code}`));
    });
    child.stdin.end(options.input);
  });
}

/** Sends bytes to a printer as they are (ESC/POS commands), bypassing its driver's rendering. */
async function sendRaw(printerName: string, data: Buffer) {
  if (process.platform === 'win32') {
    await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(WINDOWS_RAW_SCRIPT, 'utf16le').toString('base64')],
      { env: { ...process.env, POS_PRINTER: printerName, POS_DATA: data.toString('base64') } }
    );
    return;
  }
  // macOS and Linux print through CUPS; "raw" skips its filters.
  await run('lp', ['-d', printerName, '-o', 'raw', '-t', 'Open cash drawer'], { input: data });
}

/**
 * Silent receipt printing and the cash drawer. Jobs run one at a time, so a drawer kick and
 * the receipt after it reach the printer in order.
 */
export class ReceiptPrinter {
  private queue: Promise<unknown> = Promise.resolve();
  private sessionReady = false;

  constructor(
    private readonly log: Logger,
    private readonly apiOrigin: () => string | null
  ) {}

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** The print windows' own session: it may load data: URLs and the API (the logo), nothing else. */
  private printSession() {
    const printSession = session.fromPartition(PRINT_PARTITION);
    if (!this.sessionReady) {
      printSession.webRequest.onBeforeRequest((details, callback) => {
        const origin = this.apiOrigin();
        const allowed = details.url.startsWith('data:') || (!!origin && details.url.startsWith(`${origin}/`));
        callback({ cancel: !allowed });
      });
      printSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      this.sessionReady = true;
    }
    return printSession;
  }

  print(printerName: string, job: ReceiptJob) {
    return this.enqueue(() =>
      withTimeout(this.printNow(printerName, job), PRINT_TIMEOUT_MS, `The receipt printer "${printerName}" didn't answer.`)
    );
  }

  private async printNow(printerName: string, job: ReceiptJob) {
    const { paperMm } = paperFor(job.paperMm);
    const win = new BrowserWindow({
      show: false,
      width: Math.ceil(paperMm * PX_PER_MM),
      height: 800,
      useContentSize: true,
      webPreferences: {
        session: this.printSession(),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // Page scripts are blocked by the document's CSP; this only lets us measure it.
        javascript: true,
        devTools: false,
        spellcheck: false
      }
    });
    try {
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', (event) => event.preventDefault());
      const html = receiptDocument(job, this.apiOrigin());
      await win.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(html).toString('base64')}`);
      const heightPx = Number(await win.webContents.executeJavaScript('Math.ceil(document.body.scrollHeight)', false)) || 0;
      // One page as long as the receipt. Chromium turns a page wider than it is long sideways.
      const widthMicrons = paperMm * 1000;
      const heightMicrons = Math.max(Math.ceil((heightPx / PX_PER_MM) * 1000), widthMicrons + 1000);
      await new Promise<void>((resolve, reject) => {
        win.webContents.print(
          {
            silent: true,
            deviceName: printerName,
            printBackground: true,
            color: false,
            margins: { marginType: 'none' },
            pageSize: { width: widthMicrons, height: heightMicrons },
            copies: 1
          },
          (success, failureReason) => {
            if (success) resolve();
            else reject(printFailure(failureReason, printerName));
          }
        );
      });
      this.log(`Printed a receipt on ${printerName} (${paperMm} mm, ${heightPx}px long)`);
    } finally {
      if (!win.isDestroyed()) win.destroy();
    }
  }

  openDrawer(printerName: string, pin: DrawerPin) {
    return this.enqueue(async () => {
      try {
        await sendRaw(printerName, drawerPulse(pin));
        this.log(`Opened the cash drawer on ${printerName} (pin ${pin})`);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        this.log(`Couldn't open the cash drawer on ${printerName}: ${detail}`);
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error("This computer's printing system couldn't be found, so the cash drawer can't be opened.");
        }
        throw new Error(`Couldn't open the cash drawer through "${printerName}". Check that the printer is on and the drawer is plugged into it.`);
      }
    });
  }
}
