import type { FetchLike } from '@sport-performance/contracts';
import type { Translator } from '@sport-performance/i18n';
import type { QueryClient } from '@tanstack/react-query';
import { createMobileApi, type MobileApi } from '../api/client.ts';
import { createQueryClient } from '../api/query-client.ts';
import { createSessionStore, type SessionStore } from '../auth/session-store.ts';
import { createBrandingStore, type BrandingStore } from '../branding/club-branding.ts';
import type { RuntimeConfig } from '../config/runtime-config.ts';
import { deferredLocalDatabase, type LocalDatabase } from '../offline/db/database.ts';
import { createSyncEngine, type SyncEngine } from '../offline/engine.ts';
import { bindSyncToSession } from '../offline/session-binding.ts';
import type { PreferenceStorage, SecureStorage } from '../platform/storage.ts';
import { createAppTranslator } from '../ui/i18n.tsx';
import { createCompatibilityChecker, type AppBuildInfo } from '../version/index.ts';
import { createSessionController, type SessionController } from './session-controller.ts';
import { createVersionGate, type VersionGate } from './version-gate.ts';

/** What the device provides: native modules on the phone, in-memory fakes in tests. */
export interface Platform {
  readonly config: RuntimeConfig;
  readonly build: AppBuildInfo;
  readonly secureStorage: SecureStorage;
  readonly preferences: PreferenceStorage;
  readonly randomUUID: () => string;
  /** BCP 47 tags of the device languages, in order of preference. */
  readonly languageTags: readonly string[];
  readonly reportError: (error: unknown) => void;
  readonly fetch?: FetchLike;
  /** The local database (ADR 0065): encrypted SQLite on the phone, `node:sqlite` in tests. */
  readonly openLocalDatabase: () => Promise<LocalDatabase>;
}

export interface AppServices {
  readonly config: RuntimeConfig;
  readonly build: AppBuildInfo;
  readonly translator: Translator;
  readonly api: MobileApi;
  readonly sessionStore: SessionStore;
  readonly session: SessionController;
  readonly versionGate: VersionGate;
  readonly branding: BrandingStore;
  readonly queryClient: QueryClient;
  /** The local database and the offline queue (B-502): screens read and write through it. */
  readonly sync: SyncEngine;
  readonly reportError: (error: unknown) => void;
  /** Stops listening to the API client (tests; the app lives as long as the process). */
  dispose(): void;
}

/**
 * Wires the app once at launch (ADR 0058): one API client, one session
 * controller and one version gate for the whole process. Failures that
 * concern the whole app (`401`, `403` of a club, `426`) go from the client to
 * the session controller and the version gate.
 */
export function createAppServices(platform: Platform): AppServices {
  const { config, build, reportError } = platform;
  const translator = createAppTranslator(platform.languageTags);
  const sessionStore = createSessionStore({
    storage: platform.secureStorage,
    randomUUID: platform.randomUUID,
  });
  const api = createMobileApi({
    baseUrl: config.apiBaseUrl,
    build,
    locale: translator.locale,
    credentials: sessionStore,
    ...(platform.fetch !== undefined && { fetch: platform.fetch }),
  });
  const session = createSessionController({ api: api.client, store: sessionStore, reportError });
  const versionGate = createVersionGate(
    createCompatibilityChecker({
      build,
      getAppCompatibility: (input) => api.client.getAppCompatibility(input),
      storage: platform.preferences,
    }),
  );
  const queryClient = createQueryClient();
  const sync = createSyncEngine({
    database: deferredLocalDatabase(platform.openLocalDatabase()),
    api: api.client,
    randomUUID: platform.randomUUID,
    reportError,
  });
  const unbindSync = bindSyncToSession(sync, session, reportError);

  const unsubscribe = api.onFailure((event) => {
    if (event.kind === 'update_required') {
      versionGate.handleApiError(event.error).catch(reportError);
      return;
    }
    if (event.kind === 'session_expired') queryClient.clear();
    session.handleApiFailure(event);
  });
  // Another user or another club never sees the cached answers of the previous one.
  let lastScope: string | null = null;
  const unsubscribeSession = session.subscribe(() => {
    const state = session.getState();
    if (state.status === 'starting' || state.status === 'unavailable') return;
    const scope =
      state.status === 'signedIn'
        ? `${state.user.id}:${state.activeMembership?.id ?? ''}`
        : 'signedOut';
    if (lastScope !== null && scope !== lastScope) queryClient.clear();
    lastScope = scope;
  });

  return {
    config,
    build,
    translator,
    api,
    sessionStore,
    session,
    versionGate,
    branding: createBrandingStore(platform.preferences),
    queryClient,
    sync,
    reportError,
    dispose() {
      unsubscribe();
      unsubscribeSession();
      unbindSync();
      sync.dispose();
    },
  };
}
