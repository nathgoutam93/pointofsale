import { useEffect, useRef, useState } from "react";
import { readDrafts, subscribeDrafts } from "../../lib/draftStore";
import type { LocalSaleDraft } from "./types";

/**
 * The cashier's saved carts (kept in localStorage per branch and user), kept in sync with
 * other tabs, plus the id of the draft the current cart was saved as or resumed from.
 * That id is a ref, not state, so handlers that run later (checkout success, page unload)
 * always see the latest one.
 */
export function useLocalDrafts(storageKey: string) {
  const [localDrafts, setLocalDrafts] = useState<LocalSaleDraft[]>([]);
  const activeDraftIdRef = useRef<string | null>(null);
  const setActiveDraft = (id: string | null) => {
    activeDraftIdRef.current = id;
  };

  useEffect(() => {
    setLocalDrafts(readDrafts<LocalSaleDraft>(storageKey));
    // Another tab saved or removed a draft: show the same list here.
    return subscribeDrafts<LocalSaleDraft>(storageKey, setLocalDrafts);
  }, [storageKey]);

  return { localDrafts, setLocalDrafts, activeDraftIdRef, setActiveDraft };
}
