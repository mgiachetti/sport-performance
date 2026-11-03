import { ApiError, ApiNetworkError } from '@sport-performance/contracts';
import { QueryClient } from '@tanstack/react-query';

const MAX_RETRIES = 2;

/**
 * Retries only what may succeed on its own: no answer (`ApiNetworkError`,
 * aborted requests excluded) or a `5xx`/`429` with time to wait. A `4xx` is
 * an answer, and an off-contract response is a bug: retrying repeats them.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_RETRIES) return false;
  if (error instanceof ApiNetworkError) return !error.aborted;
  if (error instanceof ApiError) {
    if (error.code === 'app_update_required') return false;
    return error.status >= 500 || (error.status === 429 && error.retryAfterS !== undefined);
  }
  return false;
}

/** Backoff of 1 s, 2 s, 4 s… capped at 30 s; a `Retry-After` wins when present. */
export function retryDelayMs(failureCount: number, error: unknown): number {
  if (error instanceof ApiError && error.retryAfterS !== undefined) {
    return Math.min(error.retryAfterS, 60) * 1000;
  }
  return Math.min(1000 * 2 ** failureCount, 30_000);
}

/**
 * The React Query client of the app. Every screen reads the API through it
 * with the typed contracts client (`useApi()`), so caching, retries and the
 * refetch on returning to the foreground behave the same everywhere.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        retryDelay: retryDelayMs,
        staleTime: 30_000,
        // The app decides about offline itself (B-502: SQLite first): a query
        // without signal fails with `ApiNetworkError` instead of pausing forever.
        networkMode: 'always',
      },
      mutations: { retry: false, networkMode: 'always' },
    },
  });
}
