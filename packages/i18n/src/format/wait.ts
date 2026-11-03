/**
 * Turns a `Retry-After` in seconds into the values of `auth.rateLimitedFor`, so the web and the
 * app say the same: under a minute in whole seconds (at least 1), from a minute on in minutes
 * rounded up (never promise a shorter wait than the server asked for).
 */
export function retryWaitValues(retryAfterS: number): {
  readonly unit: 'seconds' | 'minutes';
  readonly amount: number;
} {
  const seconds = Number.isFinite(retryAfterS) ? Math.max(1, Math.ceil(retryAfterS)) : 60;
  return seconds < 60
    ? { unit: 'seconds', amount: seconds }
    : { unit: 'minutes', amount: Math.ceil(seconds / 60) };
}
