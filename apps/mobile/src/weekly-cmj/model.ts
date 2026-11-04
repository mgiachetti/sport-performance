import type {
  SyncOperationRequest,
  TestEntryInputBody,
  TestEntryInputPayload,
  TestResult,
} from '@sport-performance/contracts';
import {
  STAGE_PROFILES,
  addDays,
  aggregateCanonicalMetricAttempts,
  alertRuleAppliesTo,
  checkPlausibleValue,
  cmjHeightCmFromFlightTimeS,
  cmjMeasurementsForAlerts,
  cmjRollingBaseline,
  compareLocalDates,
  evaluateAlertRules,
  flightTimeSFromFrames,
  parseMetricCode,
  ruleFor,
  type AlertRule,
  type AlertRuleOf,
  type AttemptAggregation,
  type AvailabilityStatus,
  type CmjBaseline,
  type LocalDate,
  type Role,
  type Sex,
  type Sport,
  type Stage,
} from '@sport-performance/domain';
import { parseNumber } from '@sport-performance/i18n';
import type { LocalRow, QueuedMutation } from '../offline/local-store.ts';
import { matchesTarget } from '../offline/operations.ts';

/**
 * Weekly CMJ of M17/M19 (B-506, ADR 0079): pure rules of the screen. The
 * history comes from the synced `test_result` rows and the queue; the
 * comparison is the one of the club's `cmj_drop` rule, with the baseline
 * function the alert engine itself uses.
 */

export const WEEKLY_CMJ_TEST_CODE = 'cmj';
export const CMJ_HEIGHT_METRIC = 'cmj_height_cm';
const CMJ_HEIGHT_METRIC_CODE = parseMetricCode(CMJ_HEIGHT_METRIC);

/** How the staff measures this week: a jump app or by hand (video is B-604). */
export const WEEKLY_CMJ_METHODS = ['app', 'manual'] as const;
export type WeeklyCmjMethod = (typeof WEEKLY_CMJ_METHODS)[number];

/** What is typed per attempt: the height the app shows, or the flight time. */
export const CMJ_INPUT_MODES = ['height_cm', 'flight_time_ms'] as const;
export type CmjInputMode = (typeof CMJ_INPUT_MODES)[number];

export interface WeeklyCmjSettings {
  readonly method: WeeklyCmjMethod;
  readonly mode: CmjInputMode;
  readonly categoryId: string | null;
}

export const DEFAULT_WEEKLY_CMJ_SETTINGS: WeeklyCmjSettings = {
  method: 'app',
  mode: 'height_cm',
  categoryId: null,
};

/** Who runs it on the phone: whoever records test results (`sc` and the administration). */
export function canRecordWeeklyCmj(role: Role): boolean {
  return ruleFor('test_result', 'record', role).effect === 'allow';
}

/** The stages whose monitoring adds a weekly CMJ (`performance`: M17/M19). */
export function hasWeeklyCmj(stage: Stage | null): boolean {
  return stage !== null && STAGE_PROFILES[stage].weeklyCmj;
}

// ─── Roster ─────────────────────────────────────────────────────────────────────────

export interface WeeklyCmjPlayer {
  readonly playerId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly sex: Sex;
  readonly sport: Sport;
  readonly stage: Stage | null;
  /** Derived availability, never the cause (ADR 0029). */
  readonly availability: AvailabilityStatus | null;
}

/** The players of the category whose stage has a weekly CMJ, and how many are left out. */
export function weeklyCmjRoster(players: readonly WeeklyCmjPlayer[]): {
  readonly players: readonly WeeklyCmjPlayer[];
  readonly otherStages: number;
} {
  const included = players.filter((player) => hasWeeklyCmj(player.stage));
  return { players: included, otherStages: players.length - included.length };
}

// ─── Results ────────────────────────────────────────────────────────────────────────

type EntryInput = TestEntryInputBody;
type ServedEntry = TestResult['entries'][number];

export type ResultTarget = { readonly id: string } | { readonly clientUuid: string };

export interface CmjAttemptView {
  /** The entry id (the `clientUuid` of an attempt still in the queue). */
  readonly id: string;
  readonly attemptNumber: number | null;
  readonly heightCm: number | null;
  readonly flightTimeMs: number | null;
  readonly voidedReason: string | null;
  /** The attempt the result is scored by (`best`); `false` for `mean`. */
  readonly counts: boolean;
}

/** `queued`: not pushed yet; `sent`: the server applied it, the pull did not bring it; `saved`. */
export type CmjSyncState = 'queued' | 'sent' | 'saved';

export interface CmjResultView {
  readonly target: ResultTarget;
  readonly playerId: string;
  readonly measuredOn: LocalDate;
  readonly method: string | null;
  readonly attempts: readonly CmjAttemptView[];
  /** The result's `cmj_height_cm` with its valid attempts; `null` without one. */
  readonly heightCm: number | null;
  readonly sync: CmjSyncState;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** Height and flight time of a raw attempt, with the formulas of the domain. */
function heightOfInput(input: Record<string, unknown>): {
  heightCm: number | null;
  flightTimeMs: number | null;
} {
  try {
    if (input.kind === 'cmj_flight_time' && typeof input.flightTimeS === 'number') {
      return {
        heightCm: cmjHeightCmFromFlightTimeS(input.flightTimeS),
        flightTimeMs: input.flightTimeS * 1000,
      };
    }
    if (
      input.kind === 'cmj_video_frames' &&
      typeof input.takeoffFrame === 'number' &&
      typeof input.landingFrame === 'number' &&
      typeof input.frameRateFps === 'number'
    ) {
      const flightTimeS = flightTimeSFromFrames({
        takeoffFrame: input.takeoffFrame,
        landingFrame: input.landingFrame,
        frameRateFps: input.frameRateFps,
      });
      return {
        heightCm: cmjHeightCmFromFlightTimeS(flightTimeS),
        flightTimeMs: flightTimeS * 1000,
      };
    }
    if (
      input.kind === 'value' &&
      input.metricCode === CMJ_HEIGHT_METRIC &&
      typeof input.value === 'number' &&
      input.value > 0
    ) {
      return { heightCm: input.value, flightTimeMs: null };
    }
  } catch {
    // A value the formulas refuse: shown without a height, the server rejects it.
  }
  return { heightCm: null, flightTimeMs: null };
}

/** Whether a typed entry is a CMJ attempt (what tells a CMJ create in the queue). */
function isCmjEntry(input: EntryInput): boolean {
  return (
    input.kind === 'cmj_flight_time' ||
    input.kind === 'cmj_video_frames' ||
    (input.kind === 'value' && input.metricCode === CMJ_HEIGHT_METRIC)
  );
}

function servedAttempt(entry: ServedEntry): Omit<CmjAttemptView, 'counts'> {
  const computed = entry.values.find((value) => value.metricCode === CMJ_HEIGHT_METRIC);
  const raw =
    entry.inputs === null ? { heightCm: null, flightTimeMs: null } : heightOfInput(entry.inputs);
  return {
    id: entry.id,
    attemptNumber: entry.attemptNumber,
    heightCm: computed?.value ?? raw.heightCm,
    flightTimeMs: raw.flightTimeMs,
    voidedReason: entry.voided?.reason ?? null,
  };
}

function queuedAttempt(input: EntryInput, id: string): Omit<CmjAttemptView, 'counts'> {
  return {
    id,
    attemptNumber: input.attemptNumber ?? null,
    ...heightOfInput(input),
    voidedReason: null,
  };
}

/** Marks the attempt the result counts and its height, as the server scores it. */
function scored(
  attempts: readonly Omit<CmjAttemptView, 'counts'>[],
  aggregation: AttemptAggregation,
): { attempts: CmjAttemptView[]; heightCm: number | null } {
  const valid = attempts.flatMap((attempt, index) =>
    attempt.voidedReason === null && attempt.heightCm !== null
      ? [{ heightCm: attempt.heightCm, index }]
      : [],
  );
  if (valid.length === 0) {
    return { attempts: attempts.map((a) => ({ ...a, counts: false })), heightCm: null };
  }
  const aggregate = aggregateCanonicalMetricAttempts(
    CMJ_HEIGHT_METRIC,
    valid.map((attempt) => attempt.heightCm),
    aggregation,
  );
  const chosen = aggregate.selectedIndex === null ? null : valid[aggregate.selectedIndex]?.index;
  return {
    attempts: attempts.map((attempt, index) => ({ ...attempt, counts: index === chosen })),
    heightCm: aggregate.value,
  };
}

type CmjQueued = QueuedMutation<
  'test_result.create' | 'test_result.add_entries' | 'test_result.void_entries'
>;

/** The ops of the queue this screen reads. */
export const WEEKLY_CMJ_OPS = [
  'test_result.create',
  'test_result.add_entries',
  'test_result.void_entries',
] as const;

function syncOf(mutations: readonly CmjQueued[]): CmjSyncState {
  if (mutations.length === 0) return 'saved';
  return mutations.some((mutation) => mutation.state === 'pending') ? 'queued' : 'sent';
}

/**
 * The CMJ results of the players, from the rows of the last pull (with the
 * queued attempts and voids laid over by the store) and the creates still
 * in the queue, with the attempts and voids queued after them. Results of
 * other tests and "not done" are left out.
 */
export function cmjResults(
  rows: readonly LocalRow<'test_result'>[],
  queue: readonly CmjQueued[],
  aggregation: AttemptAggregation,
): CmjResultView[] {
  const results: CmjResultView[] = [];
  const served = new Set<string>();
  for (const row of rows) {
    if (row.clientUuid !== null) served.add(row.clientUuid);
    const data = row.data;
    if (data.testCode !== WEEKLY_CMJ_TEST_CODE || data.status !== 'done') continue;
    const attempts = data.entries.filter((entry) => entry.kind !== 'derived').map(servedAttempt);
    const touching = queue.filter((mutation) =>
      mutation.targets.some((target) =>
        matchesTarget(target, {
          collection: 'test_result',
          id: row.id,
          clientUuid: row.clientUuid,
          parentId: data.testSessionId,
          playerId: data.playerId,
        }),
      ),
    );
    results.push({
      target: { id: row.id },
      playerId: data.playerId,
      measuredOn: data.measuredOn,
      method: data.method,
      ...scored(attempts, aggregation),
      sync: row.pending ? syncOf(touching) : 'saved',
    });
  }

  for (const mutation of queue) {
    if (mutation.op !== 'test_result.create') continue;
    const { body } = (mutation as QueuedMutation<'test_result.create'>).input;
    const clientUuid = body.clientUuid;
    if (clientUuid === undefined || served.has(clientUuid)) continue;
    if (body.status !== 'done' || body.measuredOn === undefined) continue;
    if (!body.entries.some(isCmjEntry)) continue;
    let attempts = body.entries.map((entry, index) =>
      queuedAttempt(entry, entry.clientUuid ?? `${clientUuid}:${String(index)}`),
    );
    const followUps: CmjQueued[] = [mutation];
    for (const later of queue) {
      if (later.seq <= mutation.seq) continue;
      if (!later.targets.some((target) => target.clientUuid === clientUuid)) continue;
      followUps.push(later);
      if (later.op === 'test_result.add_entries') {
        const { entries } = (later as QueuedMutation<'test_result.add_entries'>).input.body;
        const present = new Set(attempts.map((attempt) => attempt.id));
        for (const entry of entries) {
          if (entry.clientUuid !== undefined && !present.has(entry.clientUuid)) {
            attempts = [...attempts, queuedAttempt(entry, entry.clientUuid)];
          }
        }
      } else if (later.op === 'test_result.void_entries') {
        const { entryIds, reason } = (later as QueuedMutation<'test_result.void_entries'>).input
          .body;
        const ids = new Set<string>(entryIds);
        attempts = attempts.map((attempt) =>
          ids.has(attempt.id) && attempt.voidedReason === null
            ? { ...attempt, voidedReason: reason }
            : attempt,
        );
      }
    }
    results.push({
      target: { clientUuid },
      playerId: body.playerId,
      measuredOn: body.measuredOn,
      method: body.method,
      ...scored(attempts, aggregation),
      sync: syncOf(followUps),
    });
  }
  return results.sort((a, b) => compareLocalDates(a.measuredOn, b.measuredOn));
}

// ─── Baseline and comparison ────────────────────────────────────────────────────────

/** The club's `cmj_drop` rules as the domain reads them; an invalid one is skipped. */
export function cmjRuleFor(
  rules: readonly AlertRule[],
  player: Pick<WeeklyCmjPlayer, 'sport' | 'sex' | 'stage'>,
): AlertRuleOf<'cmj_drop'> | null {
  const subject = {
    sport: player.sport,
    sex: player.sex,
    ...(player.stage === null ? {} : { stage: player.stage }),
  };
  for (const rule of rules) {
    if (rule.kind === 'cmj_drop' && rule.enabled && alertRuleAppliesTo(rule, subject)) return rule;
  }
  return null;
}

/** Window used when the club has no rule for the player: the default `cmj_drop`. */
export const FALLBACK_BASELINE_PARAMS = { baselineWindowDays: 42, minBaselineSamples: 3 } as const;

export type CmjVerdict =
  | {
      readonly kind: 'compared';
      readonly heightCm: number;
      readonly baselineHeightCm: number;
      /** Positive: below the baseline. */
      readonly dropPct: number;
      readonly severity: 'ok' | 'warning' | 'critical';
    }
  | { readonly kind: 'no_baseline'; readonly samples: number; readonly minSamples: number }
  | { readonly kind: 'no_rule'; readonly heightCm: number };

export interface WeeklyCmjRow {
  readonly player: WeeklyCmjPlayer;
  /** Today's results (one, or more when several phones recorded without signal). */
  readonly today: readonly CmjResultView[];
  /** Today's height (the best of today's results), `null` before the first valid attempt. */
  readonly todayHeightCm: number | null;
  /** The baseline before today with the method of this session. */
  readonly baseline: CmjBaseline;
  /** Days inside the window measured with another method: never compared (principle 4). */
  readonly otherMethodDays: number;
  readonly rule: AlertRuleOf<'cmj_drop'> | null;
  readonly verdict: CmjVerdict | null;
  readonly sync: CmjSyncState | null;
}

function best(values: readonly (number | null)[]): number | null {
  let top: number | null = null;
  for (const value of values) if (value !== null && (top === null || value > top)) top = value;
  return top;
}

function verdictOf(
  player: WeeklyCmjPlayer,
  results: readonly CmjResultView[],
  today: LocalDate,
  rule: AlertRuleOf<'cmj_drop'> | null,
  todayHeightCm: number,
): CmjVerdict {
  if (rule === null) return { kind: 'no_rule', heightCm: todayHeightCm };
  // What the worker reads: the scored results, the method of today's best jump.
  const measurements = cmjMeasurementsForAlerts(
    results.flatMap((result) =>
      result.heightCm === null || result.method === null
        ? []
        : [{ date: result.measuredOn, heightCm: result.heightCm, method: result.method }],
    ),
    today,
  );
  const baseline = cmjRollingBaseline(measurements, today, rule.params);
  if (baseline.heightCm === null) {
    return { kind: 'no_baseline', samples: baseline.samples, minSamples: baseline.minSamples };
  }
  const evaluation = evaluateAlertRules([rule], {
    date: today,
    sport: player.sport,
    sex: player.sex,
    ...(player.stage === null ? {} : { stage: player.stage }),
    cmj: { measurements, baselineHeightCm: null },
  });
  const heightCm = best(measurements.filter((m) => m.date === today).map((m) => m.heightCm));
  return {
    kind: 'compared',
    heightCm: heightCm ?? todayHeightCm,
    baselineHeightCm: baseline.heightCm,
    dropPct: ((baseline.heightCm - (heightCm ?? todayHeightCm)) / baseline.heightCm) * 100,
    severity: evaluation.alerts[0]?.severity ?? 'ok',
  };
}

/** One row per player of the weekly CMJ: today's jumps, the baseline and the verdict. */
export function weeklyCmjRows(input: {
  readonly players: readonly WeeklyCmjPlayer[];
  readonly results: readonly CmjResultView[];
  readonly rules: readonly AlertRule[];
  readonly today: LocalDate;
  readonly method: WeeklyCmjMethod;
}): WeeklyCmjRow[] {
  const { today, method } = input;
  const byPlayer = new Map<string, CmjResultView[]>();
  for (const result of input.results) {
    const list = byPlayer.get(result.playerId) ?? [];
    list.push(result);
    byPlayer.set(result.playerId, list);
  }
  return input.players.map((player) => {
    const results = (byPlayer.get(player.playerId) ?? []).filter(
      (result) => compareLocalDates(result.measuredOn, today) <= 0,
    );
    const rule = cmjRuleFor(input.rules, player);
    const params = rule?.params ?? FALLBACK_BASELINE_PARAMS;
    const measured = results.flatMap((result) =>
      result.heightCm === null ? [] : [{ date: result.measuredOn, heightCm: result.heightCm }],
    );
    const sameMethod = results.flatMap((result) =>
      result.heightCm === null || result.method !== method
        ? []
        : [{ date: result.measuredOn, heightCm: result.heightCm }],
    );
    const baseline = cmjRollingBaseline(sameMethod, today, params);
    const from = addDays(today, -params.baselineWindowDays);
    const otherDays = new Set(
      results
        .filter(
          (result) =>
            result.method !== method &&
            result.heightCm !== null &&
            compareLocalDates(result.measuredOn, from) >= 0 &&
            compareLocalDates(result.measuredOn, today) < 0,
        )
        .map((result) => result.measuredOn),
    );
    const todays = results.filter((result) => result.measuredOn === today);
    const todayHeightCm = best(measured.filter((m) => m.date === today).map((m) => m.heightCm));
    const syncStates = todays.map((result) => result.sync);
    return {
      player,
      today: todays,
      todayHeightCm,
      baseline,
      otherMethodDays: otherDays.size,
      rule,
      verdict:
        todayHeightCm === null ? null : verdictOf(player, results, today, rule, todayHeightCm),
      sync:
        syncStates.length === 0
          ? null
          : syncStates.includes('queued')
            ? 'queued'
            : syncStates.includes('sent')
              ? 'sent'
              : 'saved',
    };
  });
}

/**
 * Today's result later attempts go to: the one measured with the method of
 * the session (another method is a result of its own, never mixed).
 */
export function todayResultFor(
  row: Pick<WeeklyCmjRow, 'today'>,
  method: WeeklyCmjMethod,
): CmjResultView | null {
  return row.today.find((result) => result.method === method) ?? null;
}

/** The next player after `current` (wrapping) with nothing recorded today. */
export function nextPendingPlayer(
  rows: readonly WeeklyCmjRow[],
  current: string | null,
): string | null {
  const start = current === null ? -1 : rows.findIndex((row) => row.player.playerId === current);
  for (let step = 1; step <= rows.length; step += 1) {
    const row = rows[(start + step + rows.length) % rows.length];
    if (row?.today.length === 0 && row.player.playerId !== current) {
      return row.player.playerId;
    }
  }
  return null;
}

// ─── Typing and writing ─────────────────────────────────────────────────────────────

export type ParsedAttempt =
  | { readonly status: 'empty' }
  | { readonly status: 'invalid' }
  | {
      readonly status: 'ok';
      /** As typed: cm or ms. */
      readonly value: number;
      readonly heightCm: number;
      /** Outside the plausible range of the metric for the sex: saved only if confirmed. */
      readonly implausible: boolean;
    };

/** Most digits after the comma kept: a jump app shows one decimal, a flight time whole ms. */
const MAX_VALUE = { height_cm: 200, flight_time_ms: 2000 } as const;

/** Parses an attempt typed in es-AR (`41,5` cm, `582` ms). */
export function parseAttempt(text: string, mode: CmjInputMode, sex: Sex): ParsedAttempt {
  if (text.trim() === '') return { status: 'empty' };
  const value = parseNumber(text, { allowGrouping: false });
  if (value === null || !(value > 0) || value > MAX_VALUE[mode]) return { status: 'invalid' };
  const heightCm = mode === 'height_cm' ? value : cmjHeightCmFromFlightTimeS(value / 1000);
  const check = checkPlausibleValue({
    metricCode: CMJ_HEIGHT_METRIC_CODE,
    value: heightCm,
    sex,
    ageYears: null,
  });
  return {
    status: 'ok',
    value,
    heightCm,
    implausible: check.status === 'below' || check.status === 'above',
  };
}

/** The entry of an attempt, with its own `clientUuid` (append-only, ADR 0015). */
export function attemptEntry(input: {
  readonly mode: CmjInputMode;
  readonly value: number;
  readonly attemptNumber: number;
  readonly clientUuid: string;
  readonly recordedAt: string;
}): TestEntryInputPayload {
  const common = {
    clientUuid: input.clientUuid,
    attemptNumber: input.attemptNumber,
    recordedAt: input.recordedAt,
  };
  return input.mode === 'height_cm'
    ? { kind: 'value', metricCode: CMJ_HEIGHT_METRIC, value: input.value, ...common }
    : { kind: 'cmj_flight_time', flightTimeS: input.value / 1000, ...common };
}

/**
 * The first jumps of the day: a result outside a test day (no
 * `testSessionId`), on the club's day, with the method, the evaluator (who
 * records) and the protocol version of the catalog.
 */
export function createResultInput(input: {
  readonly clientUuid: string;
  readonly playerId: string;
  readonly testDefinitionId: string;
  readonly measuredOn: LocalDate;
  readonly method: WeeklyCmjMethod;
  readonly evaluatorId: string;
  readonly entries: readonly TestEntryInputPayload[];
}): SyncOperationRequest<'test_result.create'> {
  return {
    body: {
      status: 'done',
      clientUuid: input.clientUuid,
      playerId: input.playerId,
      testDefinitionId: input.testDefinitionId,
      measuredOn: input.measuredOn,
      method: input.method,
      evaluatorId: input.evaluatorId,
      entries: [...input.entries],
    },
  };
}

/** The attempt number after every attempt of the result (voided ones included). */
export function nextAttemptNumber(result: CmjResultView | null): number {
  let top = 0;
  for (const attempt of result?.attempts ?? []) {
    if (attempt.attemptNumber !== null && attempt.attemptNumber > top) top = attempt.attemptNumber;
  }
  return top + 1;
}

/** Whether a stored settings value is still one this build knows. */
export function parseWeeklyCmjSettings(value: unknown): WeeklyCmjSettings | null {
  if (!isRecord(value)) return null;
  const { method, mode, categoryId } = value;
  if (!(WEEKLY_CMJ_METHODS as readonly unknown[]).includes(method)) return null;
  if (!(CMJ_INPUT_MODES as readonly unknown[]).includes(mode)) return null;
  if (categoryId !== null && typeof categoryId !== 'string') return null;
  return {
    method: method as WeeklyCmjMethod,
    mode: mode as CmjInputMode,
    categoryId: categoryId,
  };
}
