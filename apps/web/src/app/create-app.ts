import type { FetchLike } from '@sport-performance/contracts';
import type { RouterHistory } from '@tanstack/react-router';
import { ClubSelectionStore } from '../api/club-selection';
import { createWebApiClient } from '../api/client';
import { ConnectionStore } from '../api/connection';
import { createQueryClient } from '../api/query-client';
import type { KeyValueStorage } from '../lib/store';
import { createAppRouter, type AppRouter } from '../router';
import { ThemeStore } from '../theme/theme-store';
import type { AppServices } from './services';

export interface CreateAppOptions {
  readonly apiUrl: string;
  readonly fetch?: FetchLike;
  readonly storage: { local: KeyValueStorage | null; session: KeyValueStorage | null };
  readonly browserOnline: boolean;
  readonly systemPrefersMoreContrast: boolean;
  readonly history?: RouterHistory;
  /** Query retries (tests use 0). */
  readonly retries?: number;
}

export interface WebApp {
  readonly services: AppServices;
  readonly router: AppRouter;
}

/**
 * Wires the app: stores, API client, query client and router. `main.tsx`
 * calls it with the browser's globals; tests with fakes (`test/render-app.tsx`).
 */
export function createWebApp(options: CreateAppOptions): WebApp {
  const selection = new ClubSelectionStore(options.storage);
  const connection = new ConnectionStore({ browserOnline: options.browserOnline });
  const theme = new ThemeStore({
    storage: options.storage.local,
    systemPrefersMoreContrast: options.systemPrefersMoreContrast,
  });
  const api = createWebApiClient({
    baseUrl: options.apiUrl,
    selection,
    connection,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });

  let expiring = false;
  const queryClient = createQueryClient({
    ...(options.retries === undefined ? {} : { retries: options.retries }),
    onSessionExpired: () => {
      // Several requests fail together when the session ends: handle it once.
      if (expiring) return;
      // A first visit without a session is not an expiry: the route sends it to the sign-in.
      const hadSession = queryClient
        .getQueriesData({ queryKey: ['session', 'me'] })
        .some(([, data]) => data !== undefined);
      if (!hadSession) return;
      expiring = true;
      const location = router.state.location;
      queryClient.clear();
      selection.clearSupport();
      void router
        .navigate({
          to: '/login',
          search: { redirect: location.href, expired: true },
          replace: true,
        })
        .finally(() => {
          expiring = false;
        });
    },
  });

  const services: AppServices = { api, queryClient, selection, connection, theme };
  // Read lazily by onSessionExpired, which only runs after the router exists.
  const router: AppRouter = createAppRouter(services, options.history);
  return { services, router };
}
