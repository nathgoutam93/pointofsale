import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { desktop } from './desktop';

/**
 * True when this business runs offline: one branch and one counter on a single computer
 * (the desktop app's offline mode, or a browser pointed at an offline API). Branches,
 * counters and stock transfers then need the business to move online.
 */
export function useIsOffline() {
  return useServerMode() === 'offline';
}

/** offline or online once known (online: the hosted server, where sign-in needs a business code). */
export function useServerMode(): 'offline' | 'online' | null {
  const known = desktop?.config.mode ?? null;
  // The desktop app knows its mode (null until chosen, with no API to ask yet).
  const meta = useMeta(!desktop);
  return known ?? meta.data?.mode ?? null;
}

/**
 * Online: managed (our hosted service: sign-up, subscriptions) or self (a business's own
 * server), as the server says; null offline or until known. Billing appears only on managed.
 */
export function useHosting(): 'managed' | 'self' | null {
  const meta = useMeta(!desktop || desktop.config.mode === 'online');
  // A fallback counter's local copy answers as an offline API: the desktop app remembers.
  return meta.data?.hosting ?? desktop?.config.hosting ?? null;
}

export function useIsManagedHosting() {
  return useHosting() === 'managed';
}

function useMeta(enabled: boolean) {
  return useQuery({
    queryKey: ['meta'],
    queryFn: async () => {
      const res = await api.meta.get();
      if (res.status !== 200) throw new Error('Failed to load server details');
      return res.body;
    },
    enabled,
    staleTime: Infinity
  });
}
