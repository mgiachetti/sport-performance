import { ApiNetworkError } from '@sport-performance/contracts';
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { isSessionExpired, isTransientError, retryDelayMs } from './errors';

export interface QueryClientOptions {
  /** Called once per failed request whose session is gone (`401` outside the sign-in). */
  readonly onSessionExpired: () => void;
  /** Tests turn retries off. */
  readonly retries?: number;
}

/**
 * TanStack Query defaults of the web (ADR 0057):
 *
 * - queries retry transient errors only (network, `502`–`504`, `429` with
 *   `Retry-After`), honouring `Retry-After`;
 * - mutations retry only when there was no response: every create carries a
 *   `clientUuid` and every edit an `expectedVersion` (ADR 0032), so sending
 *   it again cannot duplicate or overwrite. While offline they pause (the
 *   connection status counts them) and resume when the API is back;
 * - a `401` anywhere but the sign-in ends the local session.
 */
export function createQueryClient(options: QueryClientOptions): QueryClient {
  const retries = options.retries ?? 3;
  const onError = (error: unknown) => {
    if (isSessionExpired(error)) options.onSessionExpired();
  };
  return new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: (failureCount, error) => failureCount < retries && isTransientError(error),
        retryDelay: retryDelayMs,
        refetchOnWindowFocus: true,
      },
      mutations: {
        retry: (failureCount, error) =>
          failureCount < retries && error instanceof ApiNetworkError && !error.aborted,
        retryDelay: retryDelayMs,
      },
    },
  });
}
