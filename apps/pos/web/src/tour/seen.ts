/**
 * Which screens' tours someone has already been shown, so each one starts by itself only once
 * per user. Kept in this browser only; if it can't be read, tours just start again.
 */
const SEEN_KEY = "pos_tours_seen";
/** Set (to "1") to never start tours by themselves; the ? button still shows them. */
export const TOURS_OFF_KEY = "pos_tours_off";

function readAll(): Record<string, string[]> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

export function seenTours(userId: string): string[] {
  const seen = readAll()[userId];
  return Array.isArray(seen) ? seen : [];
}

export function markTourSeen(userId: string, path: string) {
  const all = readAll();
  const seen = Array.isArray(all[userId]) ? all[userId] : [];
  if (seen.includes(path)) return;
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify({ ...all, [userId]: [...seen, path] }));
  } catch {
    // Not remembered: the tour starts again next time.
  }
}

export function toursOff() {
  try {
    return localStorage.getItem(TOURS_OFF_KEY) === "1";
  } catch {
    return false;
  }
}
