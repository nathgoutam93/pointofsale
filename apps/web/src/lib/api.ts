import { initClient, tsRestFetchApi } from '@ts-rest/core';
import { appContract } from '@pos/contracts';
import { clearSession, getSession } from './session';
import { desktop } from './desktop';

/**
 * In the desktop app the API address comes from the app (the local API's port changes each
 * launch; online mode points at the hosted server). Switching mode reloads the window, so
 * reading it once is enough. In a browser it comes from the build.
 */
export const API_BASE_URL = desktop?.config.apiBaseUrl ?? import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';

export const api = initClient(appContract, {
  baseUrl: API_BASE_URL,
  baseHeaders: {},
  // An expired or revoked token returns 401; send the user back to sign in.
  api: async (args) => {
    const response = await tsRestFetchApi(args);
    if (response.status === 401 && getSession()) {
      clearSession();
      window.location.href = '/';
    }
    return response;
  }
});

export function authHeaders(): Record<string, string> {
  const session = getSession();
  if (!session) return {};

  return {
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
