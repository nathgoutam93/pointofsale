import { initClient, tsRestFetchApi } from '@ts-rest/core';
import { appContract } from '@pos/contracts';
import { clearSession, getSession, updateSession } from './session';
import { CLIENT_VERSION_HEADER, PASSWORD_CHANGE_REQUIRED, SESSION_HEADER, UPDATE_REQUIRED_STATUS } from '@pos/contracts';
import { desktop } from './desktop';
import { reportUpdateRequired } from './updates';

/** The desktop app sends its version so the server can turn away one too old for it. */
const versionHeaders: Record<string, string> = desktop ? { [CLIENT_VERSION_HEADER]: desktop.version } : {};

/**
 * Sign-ins live in an httpOnly cookie the API sets, which scripts on the page can't read. This
 * header asks for that (and is what lets the API read the cookie); see SESSION_HEADER.
 */
const sessionHeaders: Record<string, string> = { ...versionHeaders, [SESSION_HEADER]: 'cookie' };

/**
 * In the desktop app the API is reached through the app itself (app://pos/api), which forwards
 * requests to the local API or the online server and keeps the cookie. In a browser the address
 * comes from the build.
 */
export const API_BASE_URL = desktop?.config.apiBaseUrl ?? import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';

/** What every answer is checked for: an app too old for the server, a sign-in that ended, a password to change. */
function checkAnswer(status: number, body: unknown) {
  if (status === UPDATE_REQUIRED_STATUS) {
    reportUpdateRequired((body as { minClientVersion?: unknown } | null)?.minClientVersion);
  }
  // An expired or revoked sign-in: back to the sign-in screen.
  if (status === 401 && getSession()) {
    clearSession();
    window.location.href = '/';
  }
  // An admin set this user's password since they signed in: they choose their own first.
  if (
    status === 403 &&
    (body as { code?: unknown } | null)?.code === PASSWORD_CHANGE_REQUIRED &&
    getSession() &&
    window.location.pathname !== '/change-password'
  ) {
    updateSession({ mustChangePassword: true });
    window.location.href = '/change-password';
  }
}

export const api = initClient(appContract, {
  baseUrl: API_BASE_URL,
  baseHeaders: sessionHeaders,
  credentials: 'include',
  api: async (args) => {
    const response = await tsRestFetchApi(args);
    checkAnswer(response.status, response.body);
    return response;
  }
});

/**
 * For requests the typed client can't make (file uploads): the same address, cookie and
 * checks. `path` starts with a slash.
 */
export async function apiFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(sessionHeaders)) headers.set(name, value);
  const response = await fetch(`${API_BASE_URL.replace(/\/$/, '')}${path}`, { ...init, headers, credentials: 'include' });
  if (response.status === 401 || response.status === 403 || response.status === UPDATE_REQUIRED_STATUS) {
    checkAnswer(response.status, await response.clone().json().catch(() => null));
  }
  return response;
}

/** Headers for typed-client calls (`extraHeaders`). The sign-in itself travels in the cookie. */
export function authHeaders(): Record<string, string> {
  return { ...sessionHeaders };
}

/** Ends the sign-in: the API clears the cookie, then the session kept for the screens goes. */
export async function signOut() {
  await api.auth.logout({ body: {} }).catch(() => undefined);
  clearSession();
  window.location.href = '/';
}

/**
 * The address of an uploaded file (logo, item image) to show. Saved as /uploads/…; older items
 * kept the API's full address, which offline included a port that changes every launch.
 */
export function uploadSrc(saved: string | null | undefined) {
  if (!saved) return null;
  const base = API_BASE_URL.replace(/\/$/, '');
  if (saved.startsWith('/')) return `${base}${saved}`;
  try {
    const url = new URL(saved);
    const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.protocol === 'app:';
    if (local && url.pathname.includes('/uploads/')) return `${base}${url.pathname.slice(url.pathname.indexOf('/uploads/'))}`;
  } catch {
    return null;
  }
  return saved;
}

/** The API's error message: a string, or a list of validation problems joined together. */
export function apiErrorMessage(body: unknown, fallback: string) {
  if (body && typeof body === 'object' && 'message' in body) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
    if (Array.isArray(message) && message.length) return message.join(', ');
  }
  return fallback;
}
