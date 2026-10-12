const FIRST_RETRY_MS = 30_000;
const LONGEST_WAIT_MS = 6 * 60 * 60_000;

/** How long to wait after the nth failed attempt to send something (a notice, an alert): 30 s, doubling, at most 6 hours. */
export const retryDelayMs = (attempts: number) => Math.min(FIRST_RETRY_MS * 2 ** Math.max(attempts - 1, 0), LONGEST_WAIT_MS);
