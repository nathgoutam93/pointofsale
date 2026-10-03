import { initClient, tsRestFetchApi } from '@ts-rest/core';
import { appContract } from '@pos/contracts';
import { clearSession, getSession, updateSession } from './session';
import { CLIENT_VERSION_HEADER, PASSWORD_CHANGE_REQUIRED, UPDATE_REQUIRED_STATUS } from '@pos/contracts';
import { desktop } from './desktop';
import { reportUpdateRequired } from './updates';

/** The desktop app sends its version so the server can turn away one too old for it. */
const versionHeaders: Record<string, string> = desktop ? { [CLIENT_VERSION_HEADER]: desktop.version } : {};

/**
 * In the desktop app the API address comes from the app (the local API's port changes each
 * launch; online mode points at the hosted server). Switching mode reloads the window, so
 * reading it once is enough. In a browser it comes from the build.
 */
export const API_BASE_URL = desktop?.config.apiBaseUrl ?? import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';

export const api = initClient(appContract, {
  baseUrl: API_BASE_URL,
  baseHeaders: versionHeaders,
  // An expired or revoked token returns 401; send the user back to sign in.
  api: async (args) => {
    const response = await tsRestFetchApi(args);
    if (response.status === UPDATE_REQUIRED_STATUS) {
      reportUpdateRequired((response.body as { minClientVersion?: unknown } | null)?.minClientVersion);
    }
    if (response.status === 401 && getSession()) {
      clearSession();
      window.location.href = '/';
    }
    // An admin set this user's password since they signed in: they choose their own first.
    if (
      response.status === 403 &&
      (response.body as { code?: unknown } | null)?.code === PASSWORD_CHANGE_REQUIRED &&
      getSession() &&
      window.location.pathname !== '/change-password'
    ) {
      updateSession({ mustChangePassword: true });
      window.location.href = '/change-password';
    }
    return response;
  }
});

export function authHeaders(): Record<string, string> {
  const session = getSession();
  if (!session) return { ...versionHeaders };

  return {
    ...versionHeaders,
    Authorization: `Bearer ${session.token}`
  };
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
