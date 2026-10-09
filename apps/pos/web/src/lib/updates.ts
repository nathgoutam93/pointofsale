import { useEffect, useState, useSyncExternalStore } from 'react';
import { desktop, type UpdateStatus } from './desktop';

/**
 * The server turned this app away (426): it needs a newer version. The desktop app then
 * downloads and installs the update; in a browser, reloading fetches the server's own copy.
 */
let requiredVersion: string | null = null;
const listeners = new Set<() => void>();

export function reportUpdateRequired(minimum: unknown) {
  const version = typeof minimum === 'string' ? minimum : 'newer';
  if (desktop?.updates && typeof minimum === 'string') void desktop.updates.require(minimum);
  if (requiredVersion === version) return;
  requiredVersion = version;
  listeners.forEach((listener) => listener());
}

/** The version a 426 asked for, or null. */
export function useRequiredVersion() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => requiredVersion
  );
}

/** The desktop app's update status, live; null in a browser. */
export function useDesktopUpdateStatus() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  useEffect(() => {
    const updates = desktop?.updates;
    if (!updates) return;
    let active = true;
    void updates.status().then((current) => active && setStatus(current));
    const stop = updates.onStatus((next) => setStatus(next));
    return () => {
      active = false;
      stop();
    };
  }, []);
  return status;
}
