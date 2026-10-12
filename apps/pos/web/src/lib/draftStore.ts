/**
 * POS cart drafts kept in localStorage, one list per branch and user. Every change reads
 * the latest list first, so two tabs saving drafts don't overwrite each other; tabs learn
 * about each other's changes through the `storage` event (see subscribeDrafts).
 */

export const MAX_DRAFTS = 20;

export type StoredDraft = { id: string; savedAt: string; cart: unknown[] };

export function readDrafts<T extends StoredDraft>(key: string): T[] {
  const raw = localStorage.getItem(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (draft): draft is T =>
        !!draft && typeof draft.id === "string" && typeof draft.savedAt === "string" && Array.isArray(draft.cart),
    );
  } catch {
    return [];
  }
}

/** Applies `change` to the latest stored list and saves it. Throws if storage fails (e.g. full). */
export function updateDrafts<T extends StoredDraft>(key: string, change: (drafts: T[]) => T[]): T[] {
  const next = change(readDrafts<T>(key)).slice(0, MAX_DRAFTS);
  localStorage.setItem(key, JSON.stringify(next));
  return next;
}

/** Newest first; replaces any draft with the same id. */
export function upsertDraft<T extends StoredDraft>(key: string, draft: T): T[] {
  return updateDrafts<T>(key, (drafts) => [draft, ...drafts.filter((d) => d.id !== draft.id)]);
}

export function removeDrafts<T extends StoredDraft>(key: string, ids: Array<string | null | undefined>): T[] {
  const drop = new Set(ids.filter((id): id is string => !!id));
  return updateDrafts<T>(key, (drafts) => drafts.filter((d) => !drop.has(d.id)));
}

/** Calls `onChange` when another tab changes this list. Returns an unsubscribe function. */
export function subscribeDrafts<T extends StoredDraft>(key: string, onChange: (drafts: T[]) => void) {
  const handler = (event: StorageEvent) => {
    if (event.key === key || event.key === null) onChange(readDrafts<T>(key));
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}
