import { AsyncLocalStorage } from 'async_hooks';
import type { PrismaClient } from '@prisma/client';

/** A business a request runs for, on the hosted server. */
export type ActiveBusiness = { id: string; code: string; name: string; schemaName: string; dbServer: string };

type TenantStore = { business?: ActiveBusiness; client?: PrismaClient };

/**
 * Per-request context on the hosted server: each request starts with an empty store (see
 * app-config.ts) and the sign-in check or the sign-in itself fills in its business. Every
 * database call in between goes to that business's schema (see prisma.service.ts).
 */
export const tenantStorage = new AsyncLocalStorage<TenantStore>();

export function currentBusiness() {
  return tenantStorage.getStore()?.business ?? null;
}

export function currentTenantClient() {
  return tenantStorage.getStore()?.client ?? null;
}

/** Points the current request at a business. */
export function enterBusiness(business: ActiveBusiness, client: PrismaClient) {
  const store = tenantStorage.getStore();
  if (!store) throw new Error('No request context to enter a business in');
  store.business = business;
  store.client = client;
}

/** Runs `work` for a business outside a request (provisioning, tests, scripts). */
export function runForBusiness<T>(business: ActiveBusiness, client: PrismaClient, work: () => Promise<T>) {
  return tenantStorage.run({ business, client }, work);
}
