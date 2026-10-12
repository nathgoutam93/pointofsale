import { afterEach, describe, expect, it } from 'vitest';
import { TenantClients } from '../src/tenancy/tenant-clients';

// The hosted server keeps a client per business, dropping the least recently used idle one when
// full, never one a request is using; when all are busy, a new business waits for one to free.
const business = (n: number) => ({ schemaName: `b_test_${n}`, dbServer: 'default' });
const saved = process.env.TENANT_CLIENT_CACHE;
afterEach(() => {
  process.env.TENANT_CLIENT_CACHE = saved;
});

describe('tenant clients', () => {
  it('drops the least recently used idle client, and waits rather than go past the cache', async () => {
    process.env.TENANT_CLIENT_CACHE = '2';
    const clients = new TenantClients();
    const a = await clients.acquire(business(1));
    const b = await clients.acquire(business(2));
    // The same business shares its client.
    const a2 = await clients.acquire(business(1));
    expect(a2.client).toBe(a.client);

    // Both busy: a third business waits until one is free.
    let third: Awaited<ReturnType<TenantClients['acquire']>> | null = null;
    const pending = clients.acquire(business(3)).then((held) => (third = held));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(third).toBeNull();
    expect(clients.stats()).toEqual({ clients: 2, inUse: 2, waiting: 1 });

    b.release();
    b.release(); // a second release changes nothing
    await pending;
    // Business 2 (idle) made room; business 1 is still held twice.
    expect(clients.stats()).toEqual({ clients: 2, inUse: 2, waiting: 0 });
    a.release();
    a2.release();
    third!.release();
    // Business 2 again: a new client, dropping business 1 (least recently used and idle).
    const b2 = await clients.acquire(business(2));
    expect(b2.client).not.toBe(b.client);
    expect(clients.stats()).toEqual({ clients: 2, inUse: 1, waiting: 0 });
    b2.release();
    await clients.onModuleDestroy();
  });
});
