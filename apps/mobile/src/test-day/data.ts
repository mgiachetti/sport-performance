import {
  fieldStationSettingsSchema,
  testDaySheetSchema,
  type ApiClient,
  type TestDaySheet,
  type TestSession,
} from '@sport-performance/contracts';
import {
  DEFAULT_CLUB_TIME_ZONE,
  addDays,
  compareLocalDates,
  isTimeZone,
  localDateInTimeZone,
  ruleFor,
  type LocalDate,
  type MembershipRole,
  type TimeZone,
} from '@sport-performance/domain';
import type { SyncEngine } from '../offline/engine.ts';
import type { CachedRead, ReadCache, ReadCacheScope, ReadSchema } from '../offline/read-cache.ts';
import {
  TEST_DAY_OPERATIONS,
  fieldResults,
  type FieldResult,
  type FieldWrite,
  type StationSettings,
} from './model.ts';

/**
 * Reading and writing the field test day through the local database
 * (ADR 0069, ADR 0074): the days come from the synced `test_session` rows,
 * the sheet of each day and the club's context are cached reads, and every
 * write goes through the sync queue. Nothing here talks to the API but the
 * refreshes of the cached reads.
 */

/** Who sees the field test day: the roles that read test days in the matrix. */
export function canSeeTestDays(role: MembershipRole): boolean {
  return ruleFor('test_session', 'read', role).effect === 'allow';
}

export const CLUB_CONTEXT_KEY = 'club.context';
export const SHEET_KEY_PREFIX = 'testDay.sheet:';
export const sheetKey = (testSessionId: string) => `${SHEET_KEY_PREFIX}${testSessionId}`;
export const stationSettingsKey = (testSessionId: string, testCode: string) =>
  `testDay.station:${testSessionId}:${testCode}`;

/** Days ahead whose sheet is downloaded on its own, so the day can be run offline. */
export const PREFETCH_DAYS_AHEAD = 7;
/** A sheet read this recently is not downloaded again by the prefetch. */
export const SHEET_FRESH_MS = 15 * 60_000;
/** Past days the list shows. */
export const RECENT_DAYS = 30;

// ─── Club context: time zone and category names ─────────────────────────────────────

export interface ClubContext {
  readonly timeZone: string;
  readonly categories: readonly { readonly id: string; readonly name: string }[];
}

export const clubContextSchema: ReadSchema<ClubContext> = {
  safeParse(value) {
    if (typeof value !== 'object' || value === null) return { success: false };
    const { timeZone, categories } = value as Record<string, unknown>;
    if (typeof timeZone !== 'string' || !Array.isArray(categories)) return { success: false };
    const list: { id: string; name: string }[] = [];
    for (const item of categories as unknown[]) {
      if (typeof item !== 'object' || item === null) return { success: false };
      const { id, name } = item as Record<string, unknown>;
      if (typeof id !== 'string' || typeof name !== 'string') return { success: false };
      list.push({ id, name });
    }
    return { success: true, data: { timeZone, categories: list } };
  },
};

/** The club's time zone: "today" is the club's day (CLAUDE.md), the default until it is read. */
export function clubTimeZone(context: ClubContext | null): TimeZone {
  return context !== null && isTimeZone(context.timeZone)
    ? context.timeZone
    : DEFAULT_CLUB_TIME_ZONE;
}

const PAGE_LIMIT = 100;
const MAX_PAGES = 20;

export async function refreshClubContext(
  api: Pick<ApiClient, 'getClub' | 'listCategories'>,
  cache: ReadCache,
  scope: ReadCacheScope,
  signal?: AbortSignal,
): Promise<ClubContext> {
  const options = signal === undefined ? {} : { signal };
  const club = await api.getClub(undefined, options);
  const categories: { id: string; name: string }[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await api.listCategories(
      { query: { limit: PAGE_LIMIT, status: 'all', ...(cursor === undefined ? {} : { cursor }) } },
      options,
    );
    categories.push(...result.items.map((c) => ({ id: c.id, name: c.name })));
    if (result.nextCursor === null) break;
    cursor = result.nextCursor;
  }
  const context: ClubContext = { timeZone: club.timeZone, categories };
  await cache.put(scope, CLUB_CONTEXT_KEY, context);
  return context;
}

// ─── Days ───────────────────────────────────────────────────────────────────────────

export interface TestDayLists {
  /** Today and later, soonest first. */
  readonly upcoming: readonly TestSession[];
  /** The last {@link RECENT_DAYS} days, latest first. */
  readonly recent: readonly TestSession[];
}

export function testDayLists(sessions: readonly TestSession[], today: LocalDate): TestDayLists {
  const from = addDays(today, -RECENT_DAYS);
  const upcoming = sessions
    .filter((s) => compareLocalDates(s.scheduledOn, today) >= 0)
    .sort((a, b) => compareLocalDates(a.scheduledOn, b.scheduledOn));
  const recent = sessions
    .filter(
      (s) =>
        compareLocalDates(s.scheduledOn, today) < 0 && compareLocalDates(s.scheduledOn, from) >= 0,
    )
    .sort((a, b) => compareLocalDates(b.scheduledOn, a.scheduledOn));
  return { upcoming, recent };
}

/** The days of the club around today, from the local database. */
export async function loadTestDays(
  sync: Pick<SyncEngine, 'store'>,
  membershipId: string,
  today: LocalDate,
): Promise<TestSession[]> {
  const rows = await sync.store.list(membershipId, 'test_session', {
    from: addDays(today, -RECENT_DAYS),
  });
  return rows.map((row) => row.data);
}

/** Days whose sheet the prefetch downloads: not suspended, from today on, not read recently. */
export function sheetsToPrefetch(
  sessions: readonly TestSession[],
  today: LocalDate,
  /** When the sheet of each day was saved (epoch ms), by day. */
  savedAt: ReadonlyMap<string, number>,
  nowMs: number,
): string[] {
  const until = addDays(today, PREFETCH_DAYS_AHEAD);
  return sessions
    .filter(
      (s) =>
        s.status !== 'cancelled' &&
        compareLocalDates(s.scheduledOn, today) >= 0 &&
        compareLocalDates(s.scheduledOn, until) <= 0,
    )
    .filter((s) => {
      const at = savedAt.get(s.id);
      return at === undefined || nowMs - at > SHEET_FRESH_MS;
    })
    .map((s) => s.id);
}

export function today(context: ClubContext | null, nowMs: number): LocalDate {
  return localDateInTimeZone(nowMs, clubTimeZone(context));
}

// ─── Sheets ─────────────────────────────────────────────────────────────────────────

export async function refreshSheet(
  api: Pick<ApiClient, 'getTestSessionSheet'>,
  cache: ReadCache,
  scope: ReadCacheScope,
  testSessionId: string,
  signal?: AbortSignal,
): Promise<TestDaySheet> {
  const sheet = await api.getTestSessionSheet(
    { params: { testSessionId } },
    signal === undefined ? {} : { signal },
  );
  await cache.put(scope, sheetKey(testSessionId), sheet);
  return sheet;
}

export function cachedSheet(
  cache: ReadCache,
  membershipId: string,
  testSessionId: string,
): Promise<CachedRead<TestDaySheet> | null> {
  return cache.get(membershipId, sheetKey(testSessionId), testDaySheetSchema);
}

/** When each day's sheet was saved on the phone, by day. */
export async function cachedSheetTimes(
  cache: ReadCache,
  membershipId: string,
): Promise<Map<string, number>> {
  const all = await cache.list(membershipId, SHEET_KEY_PREFIX, testDaySheetSchema);
  return new Map(
    [...all].map(([key, read]) => [key.slice(SHEET_KEY_PREFIX.length), read.fetchedAt]),
  );
}

/**
 * The sheet a day is run with: the latest download wins over the saved
 * one; the saved one serves when there is no signal. The day itself
 * (status, conditions) is the synced row when it is newer.
 */
export function withSyncedDay(sheet: TestDaySheet, synced: TestSession | null): TestDaySheet {
  if (synced === null || synced.version <= sheet.testSession.version) return sheet;
  return { ...sheet, testSession: synced };
}

// ─── Results and writes ─────────────────────────────────────────────────────────────

export async function loadFieldResults(
  sync: Pick<SyncEngine, 'store'>,
  membershipId: string,
  sheet: TestDaySheet,
  viewer: MembershipRole,
): Promise<FieldResult[]> {
  const [synced, queue] = await Promise.all([
    sync.store.list(membershipId, 'test_result', { parentId: sheet.testSession.id }),
    sync.store.pending(membershipId, TEST_DAY_OPERATIONS),
  ]);
  return fieldResults({ sheet, synced, queue, viewer });
}

/** Queues the writes of one action, in order (each one validated with the server's contract). */
export async function enqueueWrites(
  sync: Pick<SyncEngine, 'enqueue'>,
  writes: readonly FieldWrite[],
): Promise<void> {
  for (const write of writes) {
    await sync.enqueue(write.op, write.input);
  }
}

/** The settings of a station on this phone, checked with their contract. */
export const stationSettingsSchema: ReadSchema<Partial<StationSettings>> = {
  safeParse(value) {
    const parsed = fieldStationSettingsSchema.safeParse(value);
    if (!parsed.success) return { success: false };
    const { mode, method, deviceId, exercise } = parsed.data;
    return {
      success: true,
      data: {
        ...(mode === undefined ? {} : { mode }),
        ...(method === undefined ? {} : { method }),
        ...(deviceId === undefined ? {} : { deviceId }),
        ...(exercise === undefined ? {} : { exercise }),
      },
    };
  },
};
