import { useEffect, useState } from "react";
import { desktop, type FallbackStatus } from "./desktop";

const bridge = desktop?.fallback ?? null;

/** True in a desktop app that can be its branch's fallback counter (online mode). */
export const canBeFallbackCounter = !!bridge && desktop?.config.mode === "online";

/** This computer's fallback counter status, kept current; null outside the desktop app. */
export function useFallbackStatus() {
  const [status, setStatus] = useState<FallbackStatus | null>(null);
  useEffect(() => {
    if (!bridge || desktop?.config.mode !== "online") return;
    let live = true;
    void bridge.status().then((next) => live && setStatus(next));
    const stop = bridge.onStatus((next) => setStatus(next));
    return () => {
      live = false;
      stop();
    };
  }, []);
  return status;
}

export const fallbackBridge = bridge;
