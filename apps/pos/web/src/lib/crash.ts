import { APP_VERSION, crashDetails } from '@pos/contracts';
import { API_BASE_URL, authHeaders } from './api';
import { desktop } from './desktop';

/** A page reports at most this many crashes, each once: a loop of errors stays one report. */
const MAX_REPORTS = 10;
const reported = new Set<string>();

/**
 * Reports a crash of the screens: only the error's first line and its stack frames, scrubbed
 * (crashDetails). In the desktop app it goes to the app, which sends it only if an admin said
 * yes. In a browser it goes to the server the page already works with (the one that holds the
 * business's data); a signed-in page lets the server note the business. Never throws.
 */
export function reportCrash(error: unknown) {
  try {
    const details = crashDetails(error);
    const key = `${details.message}\n${details.stack.split('\n')[0] ?? ''}`;
    if (reported.has(key) || reported.size >= MAX_REPORTS) return;
    reported.add(key);
    if (desktop) {
      void desktop.crashReports?.report(details).catch(() => undefined);
      return;
    }
    const report = {
      source: 'page',
      appVersion: APP_VERSION,
      mode: 'browser',
      os: navigator.userAgent.slice(0, 80),
      ...details,
      occurredAt: new Date().toISOString()
    };
    void fetch(`${API_BASE_URL.replace(/\/$/, '')}/crash-reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      credentials: 'include',
      body: JSON.stringify({ reports: [report] }),
      keepalive: true
    }).catch(() => undefined);
  } catch {
    // Reporting must never be the next crash.
  }
}

/** Uncaught errors and rejected promises of the page. */
export function watchForCrashes() {
  window.addEventListener('error', (event) => reportCrash(event.error ?? event.message));
  window.addEventListener('unhandledrejection', (event) => reportCrash(event.reason));
}
