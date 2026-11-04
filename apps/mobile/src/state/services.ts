import type { FetchLike } from '@sport-performance/contracts';
import type { Translator } from '@sport-performance/i18n';
import type { QueryClient } from '@tanstack/react-query';
import { createMobileApi, type MobileApi } from '../api/client.ts';
import { createQueryClient } from '../api/query-client.ts';
import { createSessionStore, type SessionStore } from '../auth/session-store.ts';
import { createBrandingStore, type BrandingStore } from '../branding/club-branding.ts';
import { createClubTimeZoneStore, type ClubTimeZoneStore } from '../external-load/club-day.ts';
import {
  createCmjVideoService,
  type CmjVideoPlatform,
  type CmjVideoService,
} from '../cmj-video/service.ts';
import { createSecureIftRunStore, type IftRunStore } from '../ift/run-store.ts';
import { createKioskController, type KioskController } from '../kiosk/controller.ts';
import type { Sha256Hex } from '../kiosk/pin.ts';
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
import {
  createPushRegistrar,
  type PushDevice,
  type PushRegistrar,
} from '../notifications/registration.ts';
import type { PreferenceStorage, SecureStorage } from '../platform/storage.ts';
import {
  createSprintRecordings,
  type SprintRecordings,
  type SprintVideoFiles,
} from '../sprint-video/recordings.ts';
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
  /** SHA-256 as hex (`expo-crypto` on the phone): the kiosk PIN and session fingerprint. */
  readonly sha256Hex: Sha256Hex;
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
  /** The phone's notifications (B-510): `expo-notifications` on the phone, a fake in tests. */
  readonly createPushDevice: (options: {
    /** Name of the Android channel of the pushes, in the user's language. */
    readonly channelName: string;
    readonly reportError: (error: unknown) => void;
  }) => PushDevice;
  /** The directory of the temporary sprint videos (B-605): the app's cache on the phone. */
  readonly sprintVideoFiles: SprintVideoFiles;
  /** Files and uploads of the CMJ videos (ADR 0085): `expo-file-system` on the phone. */
  readonly cmjVideo: CmjVideoPlatform;
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
  /** The time zone of each club, kept for the club day without signal. */
  readonly clubTimeZones: ClubTimeZoneStore;
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
  /** This installation as a measuring device of the club (B-606, ADR 0077). */
  readonly measuringInstallation: MeasuringInstallation;
  readonly hardware: HardwareInfo;
  /** Last answers of the API reads the sync does not move (ADR 0074), in the same database. */
  readonly readCache: ReadCache;
  /** The push token of this phone on the server and the person's choice (B-510). */
  readonly push: PushRegistrar;
  /** The phone's notifications module (taps on pushes, the settings page). */
  readonly pushDevice: PushDevice;
  /** Ids generated on the device (`clientUuid` of the writes it queues). */
  readonly randomUUID: () => string;
  /**
   * The temporary videos of the sprint by video (B-605, ADR 0082): deleted
   * at launch and whenever the user or the club changes.
   */
  readonly sprintRecordings: SprintRecordings;
  /** The CMJ videos filmed on the phone and their uploads (B-604, ADR 0085). */
  readonly cmjVideos: CmjVideoService;
  /**
   * Kiosk mode (B-504, ADR 0086): whether this device is the club's kiosk,
   * kept across launches and tied to the session it was opened with.
   */
  readonly kiosk: KioskController;
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

  const pushDevice = platform.createPushDevice({
    channelName: translator.t('staff.push.channel'),
    reportError,
  });
  const push = createPushRegistrar({
    device: pushDevice,
    api: api.client,
    preferences: platform.preferences,
    session,
    reportError,
  });
  const sprintRecordings = createSprintRecordings(platform.sprintVideoFiles);
  // A video left by a crash or a kill mid-marking never outlives the launch.
  sprintRecordings.sweep().catch(reportError);
  const cmjVideos = createCmjVideoService({
    platform: platform.cmjVideo,
    sync,
    session,
    api: api.client,
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
  const kiosk = createKioskController({
    storage: platform.secureStorage,
    sessionToken: () => sessionStore.getToken(),
    sha256Hex: platform.sha256Hex,
    randomUUID: platform.randomUUID,
    now: () => Date.now(),
    reportError,
  });
  // Another user or another club never sees the cached answers of the
  // previous one, nor its 30-15 IFT run: the signals stop and the marks of
  // its players leave the device, whether or not the screen is open; nor the
  // sprint videos being marked.
  let lastScope: string | null = null;
  const unsubscribeSession = session.subscribe(() => {
    const state = session.getState();
    if (state.status === 'starting' || state.status === 'unavailable') return;
    // The kiosk belongs to the session and membership it was opened in: any other is out of it.
    kiosk.sync(syncScopeOf(state)).catch(reportError);
    const membershipId = state.status === 'signedIn' ? (state.activeMembership?.id ?? null) : null;
    const scope =
      state.status === 'signedIn' ? `${state.user.id}:${membershipId ?? ''}` : 'signedOut';
    if (scope === lastScope) return;
    if (lastScope !== null) {
      queryClient.clear();
      // The first scope of the launch needs none: the sweep above already ran.
      sprintRecordings.sweep().catch(reportError);
    }
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
    clubTimeZones: createClubTimeZoneStore(platform.preferences),
    queryClient,
    sync,
    iftRunStore,
    iftRunner,
    measuringInstallation: createMeasuringInstallation(platform.secureStorage, platform.randomUUID),
    hardware: platform.hardware,
    readCache: createReadCache(localDatabase, {
      activeScope: () => syncScopeOf(session.getState()),
    }),
    push,
    pushDevice,
    randomUUID: platform.randomUUID,
    sprintRecordings,
    cmjVideos,
    kiosk,
    reportError,
    dispose() {
      push.dispose();
      unsubscribe();
      unsubscribeSession();
      unbindSync();
      sync.dispose();
      iftRunner.dispose();
      cmjVideos.dispose();
    },
  };
}
