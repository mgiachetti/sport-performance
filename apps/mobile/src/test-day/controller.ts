import type {
  ApiClient,
  TestDaySheet,
  TestDaySheetStation,
  TestSession,
} from '@sport-performance/contracts';
import type { LocalDate, MembershipRole } from '@sport-performance/domain';
import type { SyncEngine, SyncScopeRef } from '../offline/engine.ts';
import type { CachedValue, ReadCache } from '../offline/read-cache.ts';
import {
  CLUB_CONTEXT_KEY,
  cachedSheet,
  cachedSheetTimes,
  clubContextSchema,
  enqueueWrites,
  loadFieldResults,
  loadTestDays,
  refreshClubContext,
  refreshSheet,
  sheetsToPrefetch,
  stationSettingsKey,
  stationSettingsSchema,
  withSyncedDay,
  type ClubContext,
} from './data.ts';
import {
  playerStation,
  stationProgress,
  stationSettingsFor,
  type FieldResult,
  type FieldWrite,
  type PlayerStation,
  type StationSettings,
  type WriteContext,
} from './model.ts';

/** Roles whose evaluator id the API accepts (the club's staff). */
const EVALUATOR_ROLES: readonly MembershipRole[] = ['coach', 'sc', 'medical', 'admin'];

export interface TestDayControllerOptions {
  readonly sync: Pick<SyncEngine, 'store' | 'enqueue'>;
  /** The reads kept on the phone (`services.readCache`, ADR 0074). */
  readonly cache: ReadCache;
  readonly api: Pick<
    ApiClient,
    'getClub' | 'listCategories' | 'listSeasons' | 'getTestSessionSheet'
  >;
  readonly scope: SyncScopeRef;
  readonly role: MembershipRole;
  readonly randomUUID: () => string;
  readonly now?: () => number;
}

export interface StationView {
  readonly rows: readonly PlayerStation[];
  readonly settings: StationSettings;
}

/**
 * What the field test day screens do, outside React (ADR 0075): every read
 * from the local database, the cached reads refreshed when there is a
 * signal, and every write through the sync queue.
 */
export function createTestDayController(options: TestDayControllerOptions) {
  const { sync, cache, api, scope, role } = options;
  const now = options.now ?? Date.now;
  const membershipId = scope.membershipId;

  return {
    async clubContext(): Promise<ClubContext | null> {
      const read = await cache.get(membershipId, CLUB_CONTEXT_KEY, clubContextSchema);
      return read?.value ?? null;
    },
    refreshClubContext(signal?: AbortSignal): Promise<ClubContext> {
      return refreshClubContext(api, cache, scope, signal);
    },
    days(today: LocalDate): Promise<TestSession[]> {
      return loadTestDays(sync, membershipId, today);
    },
    savedSheets(): Promise<Map<string, number>> {
      return cachedSheetTimes(cache, membershipId);
    },
    /**
     * Downloads the sheets of the coming days that are not on the phone or
     * are old, one at a time; a failure stops it (no signal: the next try).
     */
    async prefetch(sessions: readonly TestSession[], today: LocalDate, signal?: AbortSignal) {
      const saved = await cachedSheetTimes(cache, membershipId);
      const ids = sheetsToPrefetch(sessions, today, saved, now());
      let downloaded = 0;
      for (const id of ids) {
        await refreshSheet(api, cache, scope, id, signal);
        downloaded += 1;
      }
      return downloaded;
    },
    /** The sheet saved on the phone, with the synced day when it is newer. */
    async sheet(testSessionId: string): Promise<CachedValue<TestDaySheet> | null> {
      const read = await cachedSheet(cache, membershipId, testSessionId);
      if (read === null) return null;
      const day = await sync.store.get(membershipId, 'test_session', { id: testSessionId });
      return { ...read, value: withSyncedDay(read.value, day?.data ?? null) };
    },
    refreshSheet(testSessionId: string, signal?: AbortSignal): Promise<TestDaySheet> {
      return refreshSheet(api, cache, scope, testSessionId, signal);
    },
    results(sheet: TestDaySheet): Promise<FieldResult[]> {
      return loadFieldResults(sync, membershipId, sheet, role);
    },
    progress(sheet: TestDaySheet, results: readonly FieldResult[]) {
      return new Map(
        sheet.stations.map((station) => [
          station.testCode,
          stationProgress(station, sheet.players, results),
        ]),
      );
    },
    async station(
      sheet: TestDaySheet,
      station: TestDaySheetStation,
      results: readonly FieldResult[],
    ): Promise<StationView> {
      const saved = await cache.get(
        membershipId,
        stationSettingsKey(sheet.testSession.id, station.testCode),
        stationSettingsSchema,
      );
      const rows = sheet.players
        .filter((p) => p.inCategory || results.some((r) => r.playerId === p.id))
        .map((player) => playerStation(station, player, results));
      return { rows, settings: stationSettingsFor(station, saved?.value ?? null, sheet.devices) };
    },
    saveSettings(sheet: TestDaySheet, station: TestDaySheetStation, settings: StationSettings) {
      return cache.put(scope, stationSettingsKey(sheet.testSession.id, station.testCode), settings);
    },
    writeContext(
      sheet: TestDaySheet,
      station: TestDaySheetStation,
      settings: StationSettings,
    ): WriteContext {
      return {
        sheet,
        station,
        settings,
        evaluatorId: EVALUATOR_ROLES.includes(role) ? scope.userId : null,
        uuid: options.randomUUID,
        nowIso: new Date(now()).toISOString(),
      };
    },
    submit(writes: readonly FieldWrite[]): Promise<void> {
      return enqueueWrites(sync, writes);
    },
  };
}

export type TestDayController = ReturnType<typeof createTestDayController>;
