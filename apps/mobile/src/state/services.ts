import type { FetchLike } from '@sport-performance/contracts';
import type { Translator } from '@sport-performance/i18n';
import type { QueryClient } from '@tanstack/react-query';
import { createMobileApi, type MobileApi } from '../api/client.ts';
import { createQueryClient } from '../api/query-client.ts';
import { createSessionStore, type SessionStore } from '../auth/session-store.ts';
import { createBrandingStore, type BrandingStore } from '../branding/club-branding.ts';
import { createSecureIftRunStore, type IftRunStore } from '../ift/run-store.ts';
import { createIftRunner, type IftRunner } from '../ift/runner.ts';
import type { SignalPlayer } from '../ift/signal-player.ts';
import type { RuntimeConfig } from '../config/runtime-config.ts';
import {
  createMeasuringInstallation,
  type HardwareInfo,
  type MeasuringInstallation,
} from '../reaction/installation.ts';
import { reopeningLocalDatabase, type LocalDatabase } from '../offline/db/database.ts';
import { createSyncEngine, type SyncEngine } from '../offline/engine.ts';
import { createReadCache, type ReadCache } from '../offline/read-cache.ts';
import { bindSyncToSession, syncScopeOf } from '../offline/session-binding.ts';
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
  /** The speaker of the 30-15 IFT signals (`expo-audio` on the phone). */
  readonly createSignalPlayer: (options: {
    /** Shown on the lock screen while the test runs (no player data). */
    readonly sessionTitle: string;
    readonly reportError: (error: unknown) => void;
  }) => SignalPlayer;
  /** What the phone says about itself when it registers as a measuring device (B-606). */
  readonly hardware: HardwareInfo;
  readonly fetch?: FetchLike;
  /** The local database (ADR 0069): encrypted SQLite on the phone, `node:sqlite` in tests. */
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
  /** The 30-15 IFT run left on the device (B-507). */
  readonly iftRunStore: IftRunStore;
  /**
   * The one 30-15 IFT runner of the process (ADR 0070): it outlives the
   * screen, so leaving it mid-test never stops the signals; signing out or
   * changing club does.
   */
  readonly iftRunner: IftRunner;
  /** This installation as a measuring device of the club (B-606, ADR 0075). */
  readonly measuringInstallation: MeasuringInstallation;
  readonly hardware: HardwareInfo;
  /** Last answers of the API reads the sync does not move (ADR 0074), in the same database. */
  readonly readCache: ReadCache;
  /** Ids generated on the device (`clientUuid` of the writes it queues). */
  readonly randomUUID: () => string;
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
  // One database for the sync and the read cache: an open that failed is
  // retried for both (ADR 0069).
  const localDatabase = reopeningLocalDatabase(platform.openLocalDatabase);
  const sync = createSyncEngine({
    database: localDatabase,
    api: api.client,
    randomUUID: platform.randomUUID,
    reportError,
  });
  const unbindSync = bindSyncToSession(sync, session, reportError);
  const iftRunStore = createSecureIftRunStore(platform.secureStorage);
  const iftRunner = createIftRunner({
    // Monotonic for the signals; the wall clock only anchors a run restored
    // after the app was killed.
    clock: { now: () => performance.now() },
    wallClock: () => Date.now(),
    timers: {
      setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
      clearTimeout: (handle) => {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
      },
    },
    audio: platform.createSignalPlayer({
      sessionTitle: translator.t('ift.lockScreen'),
      reportError,
    }),
    store: iftRunStore,
    randomUUID: platform.randomUUID,
    reportError,
  });

  const unsubscribe = api.onFailure((event) => {
    if (event.kind === 'update_required') {
      versionGate.handleApiError(event.error).catch(reportError);
      return;
    }
    if (event.kind === 'session_expired') queryClient.clear();
    session.handleApiFailure(event);
  });
  // Another user or another club never sees the cached answers of the
  // previous one, nor its 30-15 IFT run: the signals stop and the marks of
  // its players leave the device, whether or not the screen is open.
  let lastScope: string | null = null;
  const unsubscribeSession = session.subscribe(() => {
    const state = session.getState();
    if (state.status === 'starting' || state.status === 'unavailable') return;
    const membershipId = state.status === 'signedIn' ? (state.activeMembership?.id ?? null) : null;
    const scope =
      state.status === 'signedIn' ? `${state.user.id}:${membershipId ?? ''}` : 'signedOut';
    if (scope === lastScope) return;
    if (lastScope !== null) queryClient.clear();
    lastScope = scope;
    iftRunner
      .leaveScope(
        state.status === 'signedIn' && membershipId !== null
          ? { userId: state.user.id, membershipId }
          : null,
      )
      .catch(reportError);
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
    iftRunStore,
    iftRunner,
    measuringInstallation: createMeasuringInstallation(platform.secureStorage, platform.randomUUID),
    hardware: platform.hardware,
    readCache: createReadCache(localDatabase, {
      activeScope: () => syncScopeOf(session.getState()),
    }),
    randomUUID: platform.randomUUID,
    reportError,
    dispose() {
      unsubscribe();
      unsubscribeSession();
      unbindSync();
      sync.dispose();
      iftRunner.dispose();
    },
  };
}
