import { initClient } from '@ts-rest/core';
import { appContract } from '@pos/contracts';
import { getSession } from './session';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';

export const api = initClient(appContract, {
  baseUrl: API_BASE_URL,
  baseHeaders: {}
});

export function authHeaders(): Record<string, string> {
  const session = getSession();
  if (!session) return {};

  return {
    Authorization: `Bearer ${session.token}`
  };
}
