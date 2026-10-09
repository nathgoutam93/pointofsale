/** A page of a list, newest first (see pageQuerySchema in @pos/contracts). */
export type PageQuery = { before?: string; beforeId?: string; limit: number };

/**
 * The rows after the cursor, newest first: made before `before`, or at that same moment with a
 * smaller id (so rows made in the same millisecond aren't skipped or repeated).
 */
export function afterCursor(page: PageQuery) {
  if (!page.before) return {};
  const at = new Date(page.before);
  return page.beforeId
    ? { OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: page.beforeId } }] }
    : { createdAt: { lt: at } };
}

/** Newest first, ties by id, matching afterCursor. */
export const newestFirst = [{ createdAt: 'desc' as const }, { id: 'desc' as const }];
