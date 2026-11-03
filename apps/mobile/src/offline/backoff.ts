/** First wait after a failed sync. */
export const SYNC_RETRY_BASE_MS = 2_000;
/** Longest wait between automatic attempts (the foreground and the network also retry). */
export const SYNC_RETRY_MAX_MS = 5 * 60_000;
/** Longest `Retry-After` honored: a bigger one is a misconfigured server, not a plan. */
export const SYNC_RETRY_AFTER_MAX_MS = 15 * 60_000;

/**
 * Wait before the next automatic attempt after `failures` failed cycles in a
 * row (1 = the first failure): exponential from 2 s up to 5 min, with half
 * of it random ("equal jitter"), so the phones of a whole team that get
 * signal back at once do not retry in step. A `Retry-After` of the server
 * (`503` of a concurrent push, `429`) is a floor.
 */
export function syncRetryDelayMs(
  failures: number,
  random: () => number,
  retryAfterS?: number,
): number {
  const exponent = Math.max(0, Math.min(failures - 1, 20));
  const ceiling = Math.min(SYNC_RETRY_BASE_MS * 2 ** exponent, SYNC_RETRY_MAX_MS);
  const jittered = ceiling / 2 + random() * (ceiling / 2);
  const floor =
    retryAfterS === undefined ? 0 : Math.min(retryAfterS * 1000, SYNC_RETRY_AFTER_MAX_MS);
  return Math.round(Math.max(jittered, floor));
}
