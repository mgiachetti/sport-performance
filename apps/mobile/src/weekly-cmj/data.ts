import {
  PANEL_WEEKS_MIN,
  alertRuleSchema,
  availabilityStatusSchema,
  catalogTestSchema,
  categorySchema,
  clubSchema,
  panelPlayerSchema,
  weeklyPanelSchema,
  type ApiClient,
} from '@sport-performance/contracts';
import {
  DEFAULT_CLUB_TIME_ZONE,
  addDays,
  isTimeZone,
  localDateInTimeZone,
  parseAlertRule,
  type AlertRule,
  type LocalDate,
  type TimeZone,
} from '@sport-performance/domain';
import { ROSTER_PAGE_LIMIT, fetchAllPages } from '../ift/roster.ts';
import type { SyncEngine, SyncScopeRef } from '../offline/engine.ts';
import type { LocalStore } from '../offline/local-store.ts';
import type { CachedValue, ReadCache, ReadSchema } from '../offline/read-cache.ts';
import {
  DEFAULT_WEEKLY_CMJ_SETTINGS,
  FALLBACK_BASELINE_PARAMS,
  WEEKLY_CMJ_OPS,
  WEEKLY_CMJ_TEST_CODE,
  attemptEntry,
  cmjResults,
  createResultInput,
  nextAttemptNumber,
  parseWeeklyCmjSettings,
  weeklyCmjRoster,
  weeklyCmjRows,
  type CmjInputMode,
  type CmjResultView,
  type ResultTarget,
  type WeeklyCmjMethod,
  type WeeklyCmjRow,
  type WeeklyCmjSettings,
} from './model.ts';

/**
 * What the weekly CMJ keeps on the phone (B-506, ADR 0079): the club's
 * setup and the roster of each category are cached reads (ADR 0079's
 * `cached_read`, deleted with the membership on sign-out), the history is
 * the synced `test_result` collection plus the queue.
 */

export const WEEKLY_CMJ_SETUP_KEY = 'weekly_cmj:setup';
export const WEEKLY_CMJ_SETTINGS_KEY = 'weekly_cmj:settings';
export const weeklyCmjRosterKey = (categoryId: string): string => `weekly_cmj:roster:${categoryId}`;

/** The club's time zone, its categories, the CMJ version in force and its `cmj_drop` rules. */
export const weeklyCmjSetupSchema = clubSchema.pick({ timeZone: true }).extend({
  categories: categorySchema
    .pick({ id: true, name: true, sport: true, sex: true, defaultStage: true, sortOrder: true })
    .array(),
  test: catalogTestSchema.nullable(),
  rules: alertRuleSchema.array(),
});
export type WeeklyCmjSetup = ReturnType<typeof weeklyCmjSetupSchema.parse>;

/** The players of a category on the club's day, with their stage and availability (no cause). */
export const weeklyCmjRosterSchema = weeklyPanelSchema.pick({ today: true }).extend({
  players: panelPlayerSchema
    .pick({ playerId: true, firstName: true, lastName: true, sex: true, sport: true, stage: true })
    .extend({ availability: availabilityStatusSchema.nullable() })
    .array(),
});
export type WeeklyCmjRosterDoc = ReturnType<typeof weeklyCmjRosterSchema.parse>;

const settingsSchema: ReadSchema<WeeklyCmjSettings> = {
  safeParse(value) {
    const settings = parseWeeklyCmjSettings(value);
    return settings === null ? { success: false } : { success: true, data: settings };
  },
};

type SetupApi = Pick<
  ApiClient,
  'getClub' | 'listCategories' | 'listCatalogTests' | 'listAlertRules'
>;

const withSignal = (signal: AbortSignal | undefined) => (signal === undefined ? {} : { signal });
const page = (cursor: string | undefined) => ({
  limit: ROSTER_PAGE_LIMIT,
  ...(cursor === undefined ? {} : { cursor }),
});

/** Reads the setup from the API and keeps it (with signal, every time the screen opens). */
export async function refreshWeeklyCmjSetup(
  api: SetupApi,
  cache: ReadCache,
  scope: SyncScopeRef,
  signal?: AbortSignal,
): Promise<WeeklyCmjSetup> {
  const options = withSignal(signal);
  const [club, categories, tests, rules] = await Promise.all([
    api.getClub(undefined, options),
    fetchAllPages((cursor) =>
      api.listCategories({ query: { status: 'active', ...page(cursor) } }, options),
    ),
    fetchAllPages((cursor) => api.listCatalogTests({ query: page(cursor) }, options)),
    fetchAllPages((cursor) =>
      api.listAlertRules({ query: { kind: 'cmj_drop', ...page(cursor) } }, options),
    ),
  ]);
  const setup: WeeklyCmjSetup = {
    timeZone: club.timeZone,
    categories: [...categories]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'es'))
      .map(({ id, name, sport, sex, defaultStage, sortOrder }) => ({
        id,
        name,
        sport,
        sex,
        defaultStage,
        sortOrder,
      })),
    test: tests.find((test) => test.code === WEEKLY_CMJ_TEST_CODE) ?? null,
    rules,
  };
  await cache.put(scope, WEEKLY_CMJ_SETUP_KEY, setup);
  return setup;
}

/** Reads the roster of a category from the weekly panel (stage and availability) and keeps it. */
export async function refreshWeeklyCmjRoster(
  api: Pick<ApiClient, 'getWeeklyPanel'>,
  cache: ReadCache,
  scope: SyncScopeRef,
  categoryId: string,
  signal?: AbortSignal,
): Promise<WeeklyCmjRosterDoc> {
  const panel = await api.getWeeklyPanel(
    { query: { categoryId, weeks: PANEL_WEEKS_MIN } },
    withSignal(signal),
  );
  const roster: WeeklyCmjRosterDoc = {
    today: panel.today,
    players: panel.players.map((player) => ({
      playerId: player.playerId,
      firstName: player.firstName,
      lastName: player.lastName,
      sex: player.sex,
      sport: player.sport,
      stage: player.stage,
      availability: player.availability?.overall ?? null,
    })),
  };
  await cache.put(scope, weeklyCmjRosterKey(categoryId), roster);
  return roster;
}

export function loadWeeklyCmjSetup(
  cache: ReadCache,
  membershipId: string,
): Promise<CachedValue<WeeklyCmjSetup> | null> {
  return cache.get(membershipId, WEEKLY_CMJ_SETUP_KEY, weeklyCmjSetupSchema);
}

export function loadWeeklyCmjRoster(
  cache: ReadCache,
  membershipId: string,
  categoryId: string,
): Promise<CachedValue<WeeklyCmjRosterDoc> | null> {
  return cache.get(membershipId, weeklyCmjRosterKey(categoryId), weeklyCmjRosterSchema);
}

export async function loadWeeklyCmjSettings(
  cache: ReadCache,
  membershipId: string,
): Promise<WeeklyCmjSettings> {
  const stored = await cache.get(membershipId, WEEKLY_CMJ_SETTINGS_KEY, settingsSchema);
  return stored?.value ?? DEFAULT_WEEKLY_CMJ_SETTINGS;
}

export function saveWeeklyCmjSettings(
  cache: ReadCache,
  scope: SyncScopeRef,
  settings: WeeklyCmjSettings,
): Promise<void> {
  return cache.put(scope, WEEKLY_CMJ_SETTINGS_KEY, settings);
}

export function clubTimeZoneOf(setup: WeeklyCmjSetup | null): TimeZone {
  return setup !== null && isTimeZone(setup.timeZone) ? setup.timeZone : DEFAULT_CLUB_TIME_ZONE;
}

/** "Today" on the club's clock (CLAUDE.md: the day is the club's), also without signal. */
export function clubToday(setup: WeeklyCmjSetup | null, nowMs: number): LocalDate {
  return localDateInTimeZone(new Date(nowMs), clubTimeZoneOf(setup));
}

/** The rules as the domain reads them; one this build cannot read is left out. */
export function cmjRulesOf(setup: WeeklyCmjSetup): AlertRule[] {
  return setup.rules.flatMap((rule) => {
    try {
      return [
        parseAlertRule({
          code: rule.code,
          kind: rule.kind,
          enabled: rule.enabled,
          appliesTo: rule.appliesTo,
          params: rule.params,
        }),
      ];
    } catch {
      return [];
    }
  });
}

export interface WeeklyCmjView {
  readonly today: LocalDate;
  readonly rows: readonly WeeklyCmjRow[];
  /** Players of the category whose stage has no weekly CMJ. */
  readonly otherStages: number;
}

/**
 * The rows of a category: the roster with the stage of the weekly CMJ, the
 * results of the window from the local base and the queue, compared with
 * the club's rules on the club's day.
 */
export async function readWeeklyCmjView(input: {
  readonly store: LocalStore;
  readonly membershipId: string;
  readonly setup: WeeklyCmjSetup;
  readonly roster: WeeklyCmjRosterDoc;
  readonly settings: WeeklyCmjSettings;
  readonly nowMs: number;
}): Promise<WeeklyCmjView> {
  const { store, membershipId, setup, settings } = input;
  const today = clubToday(setup, input.nowMs);
  const rules = cmjRulesOf(setup);
  const windowDays = Math.max(
    FALLBACK_BASELINE_PARAMS.baselineWindowDays,
    ...rules.flatMap((rule) => (rule.kind === 'cmj_drop' ? [rule.params.baselineWindowDays] : [])),
  );
  const { players, otherStages } = weeklyCmjRoster(input.roster.players);
  const ids = new Set(players.map((player) => player.playerId));
  const [rows, queue] = await Promise.all([
    store.list(membershipId, 'test_result', { from: addDays(today, -windowDays), to: today }),
    store.pending(membershipId, WEEKLY_CMJ_OPS),
  ]);
  const results = cmjResults(
    rows.filter((row) => ids.has(row.data.playerId)),
    queue,
    setup.test?.attemptAggregation ?? 'best',
  ).filter((result) => ids.has(result.playerId));
  return {
    today,
    rows: weeklyCmjRows({ players, results, rules, today, method: settings.method }),
    otherStages,
  };
}

// ─── Writes: only through the queue ─────────────────────────────────────────────────

type Enqueue = Pick<SyncEngine, 'enqueue'>;

/**
 * Records typed attempts of a player: the first ones of the day create the
 * result (`test_result.create`), later ones are added to today's result
 * (`test_result.add_entries`, by its id or the `clientUuid` of its create).
 * Each attempt carries its own `clientUuid`: a resend never duplicates it.
 */
export async function recordWeeklyCmjAttempts(
  sync: Enqueue,
  input: {
    readonly existing: CmjResultView | null;
    readonly playerId: string;
    readonly testDefinitionId: string;
    readonly today: LocalDate;
    readonly method: WeeklyCmjMethod;
    readonly mode: CmjInputMode;
    readonly evaluatorId: string;
    readonly values: readonly number[];
    readonly randomUUID: () => string;
    readonly nowMs: number;
  },
): Promise<void> {
  if (input.values.length === 0) return;
  const recordedAt = new Date(input.nowMs).toISOString();
  const first = nextAttemptNumber(input.existing);
  const entries = input.values.map((value, index) =>
    attemptEntry({
      mode: input.mode,
      value,
      attemptNumber: first + index,
      clientUuid: input.randomUUID(),
      recordedAt,
    }),
  );
  if (input.existing !== null) {
    await sync.enqueue('test_result.add_entries', {
      target: input.existing.target,
      body: { entries },
    });
    return;
  }
  await sync.enqueue(
    'test_result.create',
    createResultInput({
      clientUuid: input.randomUUID(),
      playerId: input.playerId,
      testDefinitionId: input.testDefinitionId,
      measuredOn: input.today,
      method: input.method,
      evaluatorId: input.evaluatorId,
      entries,
    }),
  );
}

/** Voids an attempt with its reason (append-only: never edited, ADR 0015 / 0030). */
export async function voidWeeklyCmjAttempt(
  sync: Enqueue,
  input: { readonly target: ResultTarget; readonly entryId: string; readonly reason: string },
): Promise<void> {
  await sync.enqueue('test_result.void_entries', {
    target: input.target,
    body: { entryIds: [input.entryId], reason: input.reason },
  });
}
