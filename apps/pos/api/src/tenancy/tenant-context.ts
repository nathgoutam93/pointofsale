import { AsyncLocalStorage } from 'async_hooks';
import type { PrismaClient } from '@prisma/client';

/** A business a request runs for, on the hosted server. */
export type ActiveBusiness = {
  id: string;
  code: string;
  name: string;
  schemaName: string;
  dbServer: string;
  /** Signed-in requests: its plan and subscription dates (managed hosting enforces them). */
  billing?: BusinessBilling;
};

export type BusinessBilling = { plan: string; trialEndsAt: Date | null; paidUntil: Date | null };

/** `release`: lets the client go when the request ends (see TenantClients.acquire). */
export type TenantStore = { business?: ActiveBusiness; client?: PrismaClient; release?: () => void };

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
export function enterBusiness(business: ActiveBusiness, client: PrismaClient, release?: () => void) {
  const store = tenantStorage.getStore();
  if (!store) {
    release?.();
    throw new Error('No request context to enter a business in');
  }
  // Entering another business (or the same one again) lets the one held go.
  store.release?.();
  store.business = business;
  store.client = client;
  store.release = release;
}

/** Runs `work` for a business outside a request (provisioning, tests, scripts). */
export function runForBusiness<T>(business: ActiveBusiness, client: PrismaClient, work: () => Promise<T>) {
  return tenantStorage.run({ business, client }, work);
}
