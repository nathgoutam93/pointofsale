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
  const meta = useQuery({
    queryKey: ['meta'],
    queryFn: async () => {
      const res = await api.meta.get();
      if (res.status !== 200) throw new Error('Failed to load server details');
      return res.body;
    },
    enabled: !known,
    staleTime: Infinity
  });
  return known ?? meta.data?.mode ?? null;
}
