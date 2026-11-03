import type { ApiClient } from '@sport-performance/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { ClubSelectionStore } from '../api/club-selection';
import type { ConnectionStore } from '../api/connection';
import type { Store } from '../lib/store';
import type { ThemeStore } from '../theme/theme-store';

/**
 * Everything the app shares, built once by `createAppServices` (or by the
 * test helper with fakes) and handed to React and to the router context.
 */
export interface AppServices {
  readonly api: ApiClient;
  readonly queryClient: QueryClient;
  readonly selection: ClubSelectionStore;
  readonly connection: ConnectionStore;
  readonly theme: ThemeStore;
}

const ServicesContext = createContext<AppServices | null>(null);

export function ServicesProvider(props: { services: AppServices; children: ReactNode }) {
  return (
    <ServicesContext.Provider value={props.services}>{props.children}</ServicesContext.Provider>
  );
}

export function useServices(): AppServices {
  const services = useContext(ServicesContext);
  if (services === null) throw new Error('useServices outside <ServicesProvider>');
  return services;
}

/** Subscribes a component to one of the stores. */
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
