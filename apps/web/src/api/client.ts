import {
  API_VERSION_HEADER,
  createApiClient,
  type ApiClient,
  type FetchLike,
  type HeaderMap,
} from '@sport-performance/contracts';
import type { ConnectionStore } from './connection';

export interface WebApiClientOptions {
  readonly baseUrl: string;
  /** Headers of the club the requests act in (`ClubSelectionStore`, or none for the console). */
  readonly selection: { headers(): HeaderMap };
  readonly connection: ConnectionStore;
  /** Defaults to the global `fetch`; tests pass a fake. */
  readonly fetch?: FetchLike;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/**
 * The only API client of the web (ADR 0057): the typed client of
 * `packages/contracts` with
 *
 * - `credentials: 'include'`: the session is the `HttpOnly` cookie of the
 *   API (ADR 0028); the web never sees a token;
 * - the club headers of the current selection on every request
 *   (`X-Membership-Id`, or the superadmin's support headers);
 * - the connection store fed from every answer (reachability, `X-Api-Version`).
 */
export function createWebApiClient(options: WebApiClientOptions): ApiClient {
  const base: FetchLike = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const fetch: FetchLike = async (url, init) => {
    try {
      const response = await base(url, init);
      options.connection.reportResponse(response.headers.get(API_VERSION_HEADER));
      return response;
    } catch (error) {
      if (!isAbort(error)) options.connection.reportNetworkFailure();
      throw error;
    }
  };
  return createApiClient({
    baseUrl: options.baseUrl,
    credentials: 'include',
    fetch,
    headers: () => options.selection.headers(),
  });
}
