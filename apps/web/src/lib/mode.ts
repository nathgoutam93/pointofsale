import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { desktop } from './desktop';

/**
 * True when this business runs offline: one branch and one counter on a single computer
 * (the desktop app's offline mode, or a browser pointed at an offline API). Branches,
 * counters and stock transfers then need the business to move online.
 */
export function useIsOffline() {
  const known = desktop?.config.mode === 'offline';
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
  return known || meta.data?.mode === 'offline';
}
