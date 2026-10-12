import { app, net } from 'electron';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { release, type } from 'os';
import { join } from 'path';
import type { Logger } from './log.js';

/** A crash report as the server takes it (crashReportSchema in @pos/contracts; this app doesn't load it). */
export type CrashReport = {
  source: 'desktop' | 'local-api' | 'page';
  appVersion: string;
  mode: 'offline' | 'online' | 'fallback' | 'browser';
  os: string;
  message: string;
  stack: string;
  installId?: string;
  occurredAt: string;
};

/** Kept at most, oldest dropped first: a crash loop mustn't fill the disk. */
const QUEUE_LIMIT = 50;

/** As scrubCrashText in @pos/contracts: emails, tokens, GSTINs, numbers, URL queries, user folders. */
const SCRUBS: Array<[RegExp, string]> = [
  [/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<email>'],
  [/\beyJ[\w-]+\.[\w-]+(\.[\w-]+)?/g, '<token>'],
  [/\b[A-Za-z0-9_-]{32,}\b/g, '<token>'],
  [/\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g, '<gstin>'],
  [/\d[\d -]{4,}\d/g, '<number>'],
  [/(https?:\/\/[^\s?#'"]+)\?[^\s'"]*/g, '$1?<query>'],
  [/([A-Za-z]:\\Users\\)[^\\\n]+/gi, '$1<user>'],
  [/(\/(?:home|Users)\/)[^/\s]+/g, '$1<user>']
];
export const scrub = (text: string) => SCRUBS.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), text);

/** An error's first line and its stack frames only (later lines of some errors quote data). */
export function crashDetails(error: unknown) {
  const raw = error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Unknown error');
  const message = `${raw.name && raw.name !== 'Error' ? `${raw.name}: ` : ''}${String(raw.message ?? '').split('\n')[0]}`;
  const frames = String(raw.stack ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^at\s/.test(line))
    .slice(0, 40);
  return { message: scrub(message).slice(0, 500), stack: scrub(frames.join('\n')).slice(0, 8000) };
}

/**
 * Crash reports of this computer: kept in a file in the app's folder, and sent to the server
 * (this business's online server, or the hosted one for an offline install) once an admin has
 * said yes. Until someone answers, they wait; if the answer is no, they're dropped. Sending is
 * retried every few minutes and after each new report, so an offline computer sends them when
 * it next has internet.
 */
export class CrashReports {
  private sending = false;

  constructor(
    private readonly log: Logger,
    private readonly settings: () => { enabled: boolean | null; server: string | null; mode: CrashReport['mode']; installId: string | null }
  ) {}

  private file() {
    return join(app.getPath('userData'), 'crash-reports.json');
  }

  private read(): CrashReport[] {
    try {
      return existsSync(this.file()) ? (JSON.parse(readFileSync(this.file(), 'utf8')) as CrashReport[]) : [];
    } catch {
      return [];
    }
  }

  private write(reports: CrashReport[]) {
    // Write then rename, and synchronously: a report may be kept just before the app goes down.
    writeFileSync(`${this.file()}.tmp`, JSON.stringify(reports.slice(-QUEUE_LIMIT)), { mode: 0o600 });
    renameSync(`${this.file()}.tmp`, this.file());
  }

  queued() {
    return this.read().length;
  }

  /** Keeps a report (unless reports are turned off) and tries to send what is waiting. */
  report(source: CrashReport['source'], details: { message: string; stack: string }) {
    const { enabled, mode, installId } = this.settings();
    if (enabled === false) return;
    try {
      this.write([
        ...this.read(),
        {
          source,
          appVersion: app.getVersion(),
          mode,
          os: `${type()} ${release()} ${process.arch}`.slice(0, 80),
          message: scrub(details.message).slice(0, 500),
          stack: scrub(details.stack).slice(0, 8000),
          ...(installId ? { installId } : {}),
          occurredAt: new Date().toISOString()
        }
      ]);
    } catch (error) {
      this.log(`Couldn't keep a crash report: ${String(error)}`);
      return;
    }
    void this.flush();
  }

  /** Drops what is waiting (reports turned off). */
  clear() {
    this.write([]);
  }

  /** Sends what is waiting, 20 at a time, when allowed and a server is known. Never throws. */
  async flush() {
    const { enabled, server } = this.settings();
    if (!enabled || !server || this.sending) return;
    this.sending = true;
    try {
      for (let waiting = this.read(); waiting.length > 0; waiting = this.read()) {
        const batch = waiting.slice(0, 20);
        const res = await net.fetch(`${server.replace(/\/$/, '')}/crash-reports`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reports: batch }),
          signal: AbortSignal.timeout(15_000)
        });
        // A report the server refuses as it is (400) would be refused forever: drop it with the rest.
        if (!res.ok && res.status !== 400) return;
        this.write(this.read().slice(batch.length));
        this.log(`Sent ${batch.length} crash report${batch.length === 1 ? '' : 's'}`);
      }
    } catch {
      // No internet or no server just now: they wait for the next try.
    } finally {
      this.sending = false;
    }
  }
}
