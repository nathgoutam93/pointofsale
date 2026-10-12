import { z } from 'zod';

/**
 * Crash reports: what broke, never whose data. A report carries the error's first line and its
 * stack frames (scrubbed of anything that looks personal), the app version, the mode, the OS
 * and, at most, an anonymous install id and the business id. No request bodies, receipts,
 * names, tokens or cookies.
 */
export const crashReportSchema = z.object({
  /** desktop: the desktop app's main process; local-api: the API it runs; page: the screens. */
  source: z.enum(['desktop', 'local-api', 'page']),
  appVersion: z.string().trim().min(1).max(32),
  mode: z.enum(['offline', 'online', 'fallback', 'browser']),
  os: z.string().trim().max(80).default(''),
  message: z.string().max(500),
  stack: z.string().max(8000).default(''),
  /** The desktop app's install (its random device id), to tell one computer's reports apart. */
  installId: z.string().uuid().optional(),
  occurredAt: z.string().datetime()
});
export type CrashReport = z.infer<typeof crashReportSchema>;

/** POST /crash-reports: up to 20 reports at once (a desktop app's queue). */
export const crashReportsBodySchema = z.object({ reports: z.array(crashReportSchema).min(1).max(20) });

const SCRUBS: Array<[RegExp, string]> = [
  // Emails, then tokens (JWT-like, long base64/hex runs), then card-, phone- or id-like numbers.
  [/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<email>'],
  [/\beyJ[\w-]+\.[\w-]+(\.[\w-]+)?/g, '<token>'],
  [/\b[A-Za-z0-9_-]{32,}\b/g, '<token>'],
  [/\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g, '<gstin>'],
  [/\d[\d -]{4,}\d/g, '<number>'],
  // A URL's query string; the user's folder in a path.
  [/(https?:\/\/[^\s?#'"]+)\?[^\s'"]*/g, '$1?<query>'],
  [/([A-Za-z]:\\Users\\)[^\\\n]+/gi, '$1<user>'],
  [/(\/(?:home|Users)\/)[^/\s]+/g, '$1<user>']
];

/** Text with anything that looks personal (emails, tokens, numbers, user folders) masked. */
export function scrubCrashText(text: string) {
  return SCRUBS.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), text);
}

/**
 * An error as a report's message and stack: the first line of the message (later lines of some
 * errors, such as database ones, quote the data involved) and only the stack's frames.
 */
export function crashDetails(error: unknown): { message: string; stack: string } {
  const raw = error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Unknown error');
  const firstLine = `${raw.name && raw.name !== 'Error' ? `${raw.name}: ` : ''}${String(raw.message ?? '').split('\n')[0]}`;
  const frames = String(raw.stack ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^at\s/.test(line) || /^[\w$.<>]*@\S+:\d+:\d+$/.test(line))
    .slice(0, 40);
  return { message: scrubCrashText(firstLine).slice(0, 500), stack: scrubCrashText(frames.join('\n')).slice(0, 8000) };
}
