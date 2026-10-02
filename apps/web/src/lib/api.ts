import { initClient, tsRestFetchApi } from '@ts-rest/core';
import { appContract } from '@pos/contracts';
import { clearSession, getSession } from './session';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';

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
