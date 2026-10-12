import type { IpcMainInvokeEvent } from 'electron';
import { currentApiBaseUrl } from './fallback-counter.js';
import { APP_ORIGIN } from './protocol.js';
import { api, sessionFetch } from './services.js';
import { config } from './state.js';

/** Only the app's own pages may use the bridge. */
export function assertFromApp(event: IpcMainInvokeEvent) {
  if (!event.senderFrame?.url.startsWith(`${APP_ORIGIN}/`)) {
    throw new Error('Not allowed');
  }
}

/**
 * Backups and moving online are for admins: the API says who is signed in here (by the
 * sign-in cookie). The bridge can't trust the page's own idea of the role.
 */
export async function assertAdmin() {
  if (config.mode !== 'offline' || !api) throw new Error('Only for a business kept on this computer');
  await assertAdminOfCurrentApi();
}

/** As above, against whichever API this window works with (the local one, or the server online). */
export async function assertAdminOfCurrentApi() {
  const base = currentApiBaseUrl();
  if (!base) throw new Error('Set up this computer first');
  let res: Response;
  try {
    res = await sessionFetch(`${base}/auth/me`, { signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new Error("Couldn't reach the server to check you're an admin. Check the internet connection.");
  }
  if (res.status === 401) throw new Error('Your session has ended. Sign in again, then try once more.');
  const me = res.ok ? ((await res.json()) as { role?: string }) : null;
  if (me?.role !== 'ADMIN') throw new Error('Only an admin can do this');
}
