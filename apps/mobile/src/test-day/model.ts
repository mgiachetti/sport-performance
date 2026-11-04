import {
  attemptMetricValues,
  attemptPlausibilityWarnings,
  defaultMethodOf,
  entryModesOf,
  notDoneReasonView,
  parseAttempt,
  scoreAttemptValues,
  STAFF_METHODS,
  TYPED_ENTRY_MODES,
  type EntryMode,
  type FieldPlausibilityWarning,
  type FieldProblem,
  type NotDoneReasonView,
  type PreviewScore,
  type SyncOperationRequest,
  type TestDaySheet,
  type TestDaySheetPlayer,
  type TestDaySheetStation,
  type TestDayPreviousResult,
  type TestEntryInputPayload,
  type TestResult,
  type TestSessionResultInput,
} from '@sport-performance/contracts';
import {
  scoreTestEntry,
  testScoringSettings,
  type E1rmSetIssue,
  type MeasurementMethod,
  type Role,
  type TestNotDoneReason,
} from '@sport-performance/domain';
import type { LocalRow, QueuedMutation } from '../offline/local-store.ts';

/**
 * The field test day (B-505, ADR 0075) as pure functions: what each station
 * shows for each player — the attempts already saved on the server and the
 * ones still in this phone's queue, the best one, the previous result — and
 * the writes each action queues. Attempts are append-only (ADR 0015): a new
 * attempt is `test_result.add_entries`, a correction is
 * `test_result.void_entries`; the result is created with the first one.
 * The typing rules (fields, parsing, scores, plausibility) are the web's,
 * shared from `@sport-performance/contracts`.
 */

/** The operations of the field test day, the ones the screen reads back from the queue. */
export const TEST_DAY_OPERATIONS = [
  'test_session.record_results',
  'test_result.create',
  'test_result.add_entries',
  'test_result.void_entries',
  'test_result.update',
] as const;

// ─── Results of the day, synced and queued ──────────────────────────────────────────

export type SyncTarget = { readonly id: string } | { readonly clientUuid: string };

/** Whether a result has writes of this phone the server has not served back yet. */
export type ResultSync = 'saved' | 'sent' | 'queued';

export interface FieldEntry {
  /** The entry's id: the server's, which is the `clientUuid` the phone gave it. */
  readonly id: string;
  readonly values: readonly { readonly metricCode: string; readonly value: number }[];
  readonly voided: { readonly reason: string } | null;
  readonly issues: readonly E1rmSetIssue[];
}

/** One attempt: the entries typed together (the two sides of a 505 are two entries). */
export interface FieldAttempt {
  readonly key: string;
  readonly attemptNumber: number | null;
  readonly recordedAt: string;
  readonly entries: readonly FieldEntry[];
  /** Every entry of the attempt is voided. */
  readonly voided: boolean;
  readonly voidReason: string | null;
  /** In the queue of this phone, not served back yet. */
  readonly pending: boolean;
}

export interface FieldResult {
  /** How a write names it: its id once served, the `clientUuid` of its create before. */
  readonly target: SyncTarget;
  readonly resultId: string | null;
  readonly clientUuid: string | null;
  readonly playerId: string;
  readonly testCode: string;
  readonly status: 'done' | 'not_done';
  readonly notDoneReason: NotDoneReasonView | null;
  readonly notDoneNote: string | null;
  readonly method: MeasurementMethod | null;
  readonly deviceId: string | null;
  readonly exercise: string | null;
  readonly attempts: readonly FieldAttempt[];
  /** Ordering of the results of a player (epoch ms): the server's creation, or the queue's. */
  readonly createdAt: number;
  readonly sync: ResultSync;
}

interface MutableResult {
  target: SyncTarget;
  resultId: string | null;
  clientUuid: string | null;
  playerId: string;
  testCode: string;
  status: 'done' | 'not_done';
  notDoneReason: NotDoneReasonView | null;
  notDoneNote: string | null;
  method: MeasurementMethod | null;
  deviceId: string | null;
  exercise: string | null;
  entries: (FieldEntry & { attemptNumber: number | null; recordedAt: string; pending: boolean })[];
  createdAt: number;
  sync: ResultSync;
}

function fromServer(row: LocalRow<'test_result'>): MutableResult {
  const dto: TestResult = row.data;
  return {
    target: { id: dto.id },
    resultId: dto.id,
    clientUuid: row.clientUuid,
    playerId: dto.playerId,
    testCode: dto.testCode,
    status: dto.status,
    notDoneReason: dto.notDoneReason,
    notDoneNote: dto.notDoneNote,
    method: dto.method,
    deviceId: dto.deviceId,
    exercise: dto.exercise,
    entries: dto.entries
      // Result-level metrics the server derives (505 asymmetry) are not attempts.
      .filter((entry) => entry.kind !== 'derived')
      .map((entry) => ({
        id: entry.id,
        attemptNumber: entry.attemptNumber,
        recordedAt: entry.recordedAt,
        values: entry.values.map((v) => ({ metricCode: v.metricCode, value: v.value })),
        voided: entry.voided === null ? null : { reason: entry.voided.reason },
        issues: entry.issues,
        pending: false,
      })),
    createdAt: Date.parse(dto.createdAt),
    sync: 'saved',
  };
}

function queuedEntries(
  station: TestDaySheetStation | undefined,
  testCode: string,
  entries: readonly TestEntryInputPayload[],
  at: string,
): MutableResult['entries'] {
  const settings = testScoringSettings(station?.definition.protocol.parameters);
  return entries.map((entry) => {
    let values: FieldEntry['values'] = [];
    let issues: readonly E1rmSetIssue[] = [];
    try {
      const scored = scoreTestEntry(testCode, entry, settings);
      values = scored.values.map((v) => ({ metricCode: v.metricCode, value: v.value }));
      issues = scored.issues;
    } catch {
      // The contract accepted it but the domain cannot score it: the server will answer.
    }
    return {
      id: entry.clientUuid ?? '',
      attemptNumber: entry.attemptNumber ?? null,
      recordedAt: entry.recordedAt ?? at,
      values,
      voided: null,
      issues,
      pending: true,
    };
  });
}

function fromQueue(
  input: TestSessionResultInput,
  station: TestDaySheetStation | undefined,
  queued: QueuedMutation,
  viewer: Role,
): MutableResult | null {
  if (station === undefined || input.clientUuid === undefined) return null;
  const at = new Date(queued.createdAt).toISOString();
  return {
    target: { clientUuid: input.clientUuid },
    resultId: null,
    clientUuid: input.clientUuid,
    playerId: input.playerId,
    testCode: station.testCode,
    status: input.status,
    notDoneReason:
      input.status === 'not_done' ? notDoneReasonView(input.notDoneReason, viewer) : null,
    notDoneNote: input.status === 'not_done' ? (input.notDoneNote ?? null) : null,
    method: input.method ?? null,
    deviceId: input.deviceId ?? null,
    exercise: input.exercise ?? null,
    entries:
      input.status === 'done' ? queuedEntries(station, station.testCode, input.entries, at) : [],
    createdAt: queued.createdAt,
    sync: queued.state === 'pending' ? 'queued' : 'sent',
  };
}

function matches(result: MutableResult, target: SyncTarget): boolean {
  return 'id' in target ? result.resultId === target.id : result.clientUuid === target.clientUuid;
}

function touch(result: MutableResult, queued: QueuedMutation): void {
  if (queued.state === 'pending') result.sync = 'queued';
  else if (result.sync === 'saved') result.sync = 'sent';
}

function groupAttempts(result: MutableResult): FieldAttempt[] {
  const groups = new Map<string, MutableResult['entries']>();
  for (const entry of result.entries) {
    const key =
      entry.attemptNumber === null ? `entry:${entry.id}` : `n:${String(entry.attemptNumber)}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups].map(([key, entries]) => {
    const first = entries[0];
    const voided = entries.every((entry) => entry.voided !== null);
    return {
      key: `${result.clientUuid ?? result.resultId ?? ''}:${key}`,
      attemptNumber: first?.attemptNumber ?? null,
      recordedAt: entries.reduce(
        (min, entry) => (entry.recordedAt < min ? entry.recordedAt : min),
        first?.recordedAt ?? '',
      ),
      entries: entries.map(({ id, values, voided: v, issues }) => ({
        id,
        values,
        voided: v,
        issues,
      })),
      voided,
      voidReason: voided ? (entries.find((e) => e.voided !== null)?.voided?.reason ?? null) : null,
      pending: entries.some((entry) => entry.pending),
    };
  });
}

/**
 * The results of a test day as the screen shows them: the rows of the last
 * pull (with the queued corrections laid over by the local store) plus the
 * results created on this phone that have not come back, with the queued
 * attempts, voids and corrections applied in queue order. Applying a
 * mutation twice (served and still in the queue for a while) changes
 * nothing: entries are matched by their id, which is their `clientUuid`.
 */
export function fieldResults(input: {
  readonly sheet: Pick<TestDaySheet, 'testSession' | 'stations'>;
  readonly synced: readonly LocalRow<'test_result'>[];
  readonly queue: readonly QueuedMutation[];
  readonly viewer: Role;
}): FieldResult[] {
  const { sheet, viewer } = input;
  const sessionId = sheet.testSession.id;
  const stationByDefinition = new Map<string, TestDaySheetStation>(
    sheet.stations.map((s) => [s.definition.id, s]),
  );
  const stationByCode = new Map(sheet.stations.map((s) => [s.testCode, s]));
  const results: MutableResult[] = input.synced
    .filter((row) => row.data.testSessionId === sessionId)
    .map(fromServer);
  const served = new Set(results.flatMap((r) => (r.clientUuid === null ? [] : [r.clientUuid])));

  for (const queued of input.queue) {
    const { op } = queued;
    if (op === 'test_session.record_results') {
      const { params, body } = (queued as QueuedMutation<'test_session.record_results'>).input;
      if (params.testSessionId !== sessionId) continue;
      for (const result of body.results) {
        if (result.clientUuid !== undefined && served.has(result.clientUuid)) continue;
        const station = stationByDefinition.get(result.testDefinitionId);
        const local = fromQueue(result, station, queued, viewer);
        if (local !== null) results.push(local);
      }
    } else if (op === 'test_result.create') {
      const { body } = (queued as QueuedMutation<'test_result.create'>).input;
      if (body.testSessionId !== sessionId) continue;
      if (body.clientUuid !== undefined && served.has(body.clientUuid)) continue;
      const result: TestSessionResultInput = body;
      const station = stationByDefinition.get(result.testDefinitionId);
      const local = fromQueue(result, station, queued, viewer);
      if (local !== null) results.push(local);
    } else if (op === 'test_result.add_entries') {
      const { target, body } = (queued as QueuedMutation<'test_result.add_entries'>).input;
      const result = results.find((r) => matches(r, target));
      if (result === undefined) continue;
      // The local store already lays these attempts over the synced row (the
      // `add_entries` overlay), without the scores it cannot compute: while
      // the mutation is queued, each one is the attempt scored here, pending,
      // in its place (one the overlay did not lay goes at the end).
      const added = queuedEntries(
        stationByCode.get(result.testCode),
        result.testCode,
        body.entries,
        new Date(queued.createdAt).toISOString(),
      );
      const byId = new Map(added.filter((e) => e.id !== '').map((e) => [e.id, e]));
      const laid = new Set<string>();
      result.entries = result.entries.map((entry) => {
        const local = byId.get(entry.id);
        if (local === undefined) return entry;
        laid.add(entry.id);
        return local;
      });
      result.entries.push(...added.filter((e) => !laid.has(e.id)));
      touch(result, queued);
    } else if (op === 'test_result.void_entries') {
      const { target, body } = (queued as QueuedMutation<'test_result.void_entries'>).input;
      const result = results.find((r) => matches(r, target));
      if (result === undefined) continue;
      const ids = new Set<string>(body.entryIds);
      result.entries = result.entries.map((entry) =>
        ids.has(entry.id) && entry.voided === null
          ? { ...entry, voided: { reason: body.reason } }
          : entry,
      );
      touch(result, queued);
    } else if (op === 'test_result.update') {
      const { target, body } = (queued as QueuedMutation<'test_result.update'>).input;
      const result = results.find((r) => matches(r, target));
      if (result === undefined) continue;
      if (body.status !== undefined) result.status = body.status;
      if (body.notDoneReason !== undefined) {
        result.notDoneReason =
          body.notDoneReason === null ? null : notDoneReasonView(body.notDoneReason, viewer);
      }
      if (body.notDoneNote !== undefined) result.notDoneNote = body.notDoneNote;
      if (body.method !== undefined) result.method = body.method;
      if (body.deviceId !== undefined) result.deviceId = body.deviceId;
      if (body.exercise !== undefined) result.exercise = body.exercise;
      touch(result, queued);
    }
  }

  return results.map((result) => ({
    target: result.target,
    resultId: result.resultId,
    clientUuid: result.clientUuid,
    playerId: result.playerId,
    testCode: result.testCode,
    status: result.status,
    notDoneReason: result.notDoneReason,
    notDoneNote: result.notDoneNote,
    method: result.method,
    deviceId: result.deviceId,
    exercise: result.exercise,
    attempts: groupAttempts(result),
    createdAt: result.createdAt,
    sync: result.sync,
  }));
}

// ─── A player at a station ──────────────────────────────────────────────────────────

export interface ShownAttempt extends FieldAttempt {
  /** The best attempt of some metric scored by `best` (all the results of the player together). */
  readonly bestOf: readonly string[];
}

export interface PlayerStation {
  readonly player: TestDaySheetPlayer;
  readonly applicable: boolean;
  readonly notApplicableReason: TestDaySheetPlayer['tests'][number]['reason'];
  readonly previous: TestDayPreviousResult | null;
  /** Every result of the player for this test on the day (more than one: several evaluators). */
  readonly results: readonly FieldResult[];
  /** The result new attempts go to: the first `done` one, served before queued; `null` creates one. */
  readonly primary: FieldResult | null;
  /** A `not_done` result with nothing `done`: attempts turn it into `done` first. */
  readonly notDone: FieldResult | null;
  /** All attempts, in the order they were recorded. */
  readonly attempts: readonly ShownAttempt[];
  readonly scores: readonly PreviewScore[];
  readonly validAttemptCount: number;
  readonly nextAttemptNumber: number;
  readonly sync: ResultSync;
  readonly state: 'empty' | 'done' | 'not_done';
  /** Results `done` and `not_done` at once, or several `done` (offline evaluators). */
  readonly multipleResults: boolean;
}

const SYNC_ORDER: Record<ResultSync, number> = { saved: 0, sent: 1, queued: 2 };

export function playerStation(
  station: TestDaySheetStation,
  player: TestDaySheetPlayer,
  results: readonly FieldResult[],
): PlayerStation {
  const own = results
    .filter((r) => r.playerId === player.id && r.testCode === station.testCode)
    .sort((a, b) => {
      // Served first (every phone picks the same one), then by creation.
      const served = Number(a.resultId === null) - Number(b.resultId === null);
      return served !== 0 ? served : a.createdAt - b.createdAt;
    });
  const done = own.filter((r) => r.status === 'done');
  const primary = done[0] ?? null;
  const notDone = primary === null ? (own.find((r) => r.status === 'not_done') ?? null) : null;
  const attempts = done
    .flatMap((r) => r.attempts)
    .sort((a, b) =>
      a.recordedAt === b.recordedAt
        ? (a.attemptNumber ?? 0) - (b.attemptNumber ?? 0)
        : a.recordedAt < b.recordedAt
          ? -1
          : 1,
    );
  const valid = attempts.filter((a) => !a.voided);
  // Attempts of several phones may share a number: score them by position.
  const scored = scoreAttemptValues(
    station,
    valid.flatMap((attempt, index) =>
      attempt.entries
        .filter((e) => e.voided === null)
        .flatMap((e) => e.values.map((v) => ({ ...v, attemptNumber: index + 1 }))),
    ),
  );
  const bestOf = new Map<string, string[]>();
  for (const [metricCode, position] of scored.bestAttempt) {
    const attempt = valid[position - 1];
    if (attempt !== undefined)
      bestOf.set(attempt.key, [...(bestOf.get(attempt.key) ?? []), metricCode]);
  }
  const test = player.tests.find((t) => t.testCode === station.testCode);
  const sync = own.reduce<ResultSync>(
    (worst, r) => (SYNC_ORDER[r.sync] > SYNC_ORDER[worst] ? r.sync : worst),
    'saved',
  );
  return {
    player,
    applicable: test?.applicable ?? false,
    notApplicableReason: test?.reason ?? 'not_in_battery',
    previous: player.previous.find((p) => p.testCode === station.testCode) ?? null,
    results: own,
    primary,
    notDone,
    attempts: attempts.map((a) => ({ ...a, bestOf: bestOf.get(a.key) ?? [] })),
    scores: scored.scores,
    validAttemptCount: valid.length,
    nextAttemptNumber:
      own.reduce(
        (max, r) => r.attempts.reduce((m, a) => Math.max(m, a.attemptNumber ?? 0), max),
        0,
      ) + 1,
    sync,
    state: primary !== null ? 'done' : notDone !== null ? 'not_done' : 'empty',
    multipleResults:
      done.length > 1 || (done.length > 0 && own.some((r) => r.status === 'not_done')),
  };
}

/** How far a station is: players with a result (done or not) out of the roster of the day. */
export function stationProgress(
  station: TestDaySheetStation,
  players: readonly TestDaySheetPlayer[],
  results: readonly FieldResult[],
): { readonly recorded: number; readonly total: number } {
  const roster = players.filter((p) => p.inCategory || results.some((r) => r.playerId === p.id));
  const recorded = roster.filter((p) =>
    results.some((r) => r.playerId === p.id && r.testCode === station.testCode),
  ).length;
  return { recorded, total: roster.length };
}

/** The next player after `playerId` with nothing recorded at the station and who can be recorded. */
export function nextPendingPlayer(
  rows: readonly PlayerStation[],
  playerId: string | null,
): string | null {
  const start = playerId === null ? -1 : rows.findIndex((r) => r.player.id === playerId);
  const ordered = [...rows.slice(start + 1), ...rows.slice(0, Math.max(start, 0))];
  const next = ordered.find(
    (r) => r.state === 'empty' && r.applicable && r.player.recording === 'allowed',
  );
  return next?.player.id ?? null;
}

// ─── Settings of a station on this phone ────────────────────────────────────────────

export interface StationSettings {
  readonly mode: EntryMode;
  readonly method: MeasurementMethod;
  readonly deviceId: string | null;
  /** Strength exercise (`snake_case`), required by the API for strength. */
  readonly exercise: string | null;
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value !== '';

/**
 * The settings of a station as stored on this phone (ADR 0075), each one
 * optional; `null` when the stored document no longer fits (another build).
 * Whether each value still fits the station is checked by
 * {@link stationSettingsFor} when it is read back.
 */
export function parseStoredStationSettings(value: unknown): Partial<StationSettings> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { mode, method, deviceId, exercise } = value as Record<string, unknown>;
  if (mode !== undefined && !(TYPED_ENTRY_MODES as readonly unknown[]).includes(mode)) return null;
  if (method !== undefined && !(STAFF_METHODS as readonly unknown[]).includes(method)) return null;
  if (deviceId !== undefined && deviceId !== null && !isNonEmptyString(deviceId)) return null;
  if (exercise !== undefined && exercise !== null && !isNonEmptyString(exercise)) return null;
  return {
    ...(mode === undefined ? {} : { mode: mode as EntryMode }),
    ...(method === undefined ? {} : { method: method as MeasurementMethod }),
    ...(deviceId === undefined ? {} : { deviceId }),
    ...(exercise === undefined ? {} : { exercise }),
  };
}

export function defaultStationSettings(station: TestDaySheetStation): StationSettings {
  return {
    mode: entryModesOf(station)[0] ?? 'value',
    method: defaultMethodOf(station.testCode),
    deviceId: null,
    exercise: null,
  };
}

/** Saved settings, kept only while they still fit the station (another protocol version). */
export function stationSettingsFor(
  station: TestDaySheetStation,
  saved: Partial<StationSettings> | null,
  devices: TestDaySheet['devices'],
): StationSettings {
  const base = defaultStationSettings(station);
  if (saved === null) return base;
  const modes = entryModesOf(station);
  return {
    mode: saved.mode !== undefined && modes.includes(saved.mode) ? saved.mode : base.mode,
    method:
      saved.method !== undefined && (STAFF_METHODS as readonly string[]).includes(saved.method)
        ? saved.method
        : base.method,
    deviceId:
      saved.deviceId !== undefined &&
      saved.deviceId !== null &&
      devices.some((d) => d.id === saved.deviceId)
        ? saved.deviceId
        : null,
    exercise: station.testCode === 'strength' ? (saved.exercise ?? null) : null,
  };
}

const EXERCISE_CODE = /^[a-z][a-z0-9_]{0,62}$/;
export function isExerciseCode(value: string): boolean {
  return EXERCISE_CODE.test(value);
}

// ─── Writes ─────────────────────────────────────────────────────────────────────────

export type FieldWrite =
  | {
      readonly op: 'test_session.record_results';
      readonly input: SyncOperationRequest<'test_session.record_results'>;
    }
  | {
      readonly op: 'test_result.add_entries';
      readonly input: SyncOperationRequest<'test_result.add_entries'>;
    }
  | {
      readonly op: 'test_result.void_entries';
      readonly input: SyncOperationRequest<'test_result.void_entries'>;
    }
  | {
      readonly op: 'test_result.update';
      readonly input: SyncOperationRequest<'test_result.update'>;
    };

export interface WriteContext {
  readonly sheet: Pick<TestDaySheet, 'testSession'>;
  readonly station: TestDaySheetStation;
  readonly settings: StationSettings;
  /** Who records: the evaluator of each result (several evaluators on one day). */
  readonly evaluatorId: string | null;
  readonly uuid: () => string;
  /** Now, ISO 8601: when each attempt was recorded (orders the attempts of several phones). */
  readonly nowIso: string;
}

export type WriteProblem =
  | {
      readonly kind: 'attempt';
      readonly fieldKey: string | null;
      readonly problem: FieldProblem | 'domain';
    }
  | { readonly kind: 'empty' }
  | { readonly kind: 'exercise' }
  | { readonly kind: 'device' }
  | { readonly kind: 'reason' }
  | { readonly kind: 'note' }
  | { readonly kind: 'changeReason' }
  | { readonly kind: 'notApplicable' }
  | { readonly kind: 'recording' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'hasAttempts' };

export type PlannedWrites =
  | { readonly kind: 'problem'; readonly problem: WriteProblem }
  | {
      readonly kind: 'writes';
      readonly writes: readonly FieldWrite[];
      /** Out of the plausible range: the screen asks to confirm before queuing. */
      readonly warnings: readonly FieldPlausibilityWarning[];
    };

function problem(p: WriteProblem): PlannedWrites {
  return { kind: 'problem', problem: p };
}

function blocked(context: WriteContext, row: PlayerStation): WriteProblem | null {
  if (context.sheet.testSession.status === 'cancelled') return { kind: 'cancelled' };
  if (row.player.recording !== 'allowed') return { kind: 'recording' };
  return null;
}

function recordOne(context: WriteContext, result: TestSessionResultInput): FieldWrite {
  return {
    op: 'test_session.record_results',
    input: { params: { testSessionId: context.sheet.testSession.id }, body: { results: [result] } },
  };
}

/**
 * The writes of one more attempt of a player: the result with this attempt
 * when the player has none, or the attempt added to the result they have
 * (turning a `not_done` into `done` first, which asks for a reason). The
 * typed values go through the shared parser; the plausibility warnings come
 * back for the screen to confirm.
 */
export function planAttempt(
  context: WriteContext,
  row: PlayerStation,
  values: Readonly<Record<string, string>>,
  options: { readonly method?: MeasurementMethod; readonly changeReason?: string } = {},
): PlannedWrites {
  const stop = blocked(context, row);
  if (stop !== null) return problem(stop);
  if (!row.applicable) return problem({ kind: 'notApplicable' });
  const { station, settings } = context;
  const parsed = parseAttempt(station, settings.mode, values, row.player.strengthAssessment);
  if (parsed.status === 'empty') return problem({ kind: 'empty' });
  if (parsed.status === 'invalid') {
    return problem({ kind: 'attempt', fieldKey: parsed.fieldKey, problem: parsed.problem });
  }
  const isStrength = station.testCode === 'strength';
  const exercise = row.primary?.exercise ?? settings.exercise;
  if (isStrength && (exercise === null || !isExerciseCode(exercise))) {
    return problem({ kind: 'exercise' });
  }
  const deviceId = row.primary?.deviceId ?? settings.deviceId;
  if (station.definition.sameDeviceOnly && deviceId === null) return problem({ kind: 'device' });

  const attemptNumber = row.nextAttemptNumber;
  const entries: TestEntryInputPayload[] = parsed.entries.map(({ entry }) => ({
    ...entry,
    clientUuid: context.uuid(),
    attemptNumber,
    recordedAt: context.nowIso,
  }));
  const warnings = attemptPlausibilityWarnings(
    station,
    settings.mode,
    parsed,
    row.player,
    context.sheet.testSession.scheduledOn,
  );
  const method = options.method ?? settings.method;
  const writes: FieldWrite[] = [];
  if (row.primary !== null) {
    writes.push({
      op: 'test_result.add_entries',
      input: { target: row.primary.target, body: { entries } },
    });
  } else if (row.notDone !== null) {
    const changeReason = options.changeReason?.trim() ?? '';
    if (changeReason === '') return problem({ kind: 'changeReason' });
    writes.push(
      {
        op: 'test_result.update',
        input: {
          target: row.notDone.target,
          body: {
            changeReason,
            status: 'done',
            method,
            notDoneReason: null,
            notDoneNote: null,
            ...(isStrength && exercise !== null ? { exercise } : {}),
            ...(station.definition.sameDeviceOnly && deviceId !== null ? { deviceId } : {}),
          },
        },
      },
      { op: 'test_result.add_entries', input: { target: row.notDone.target, body: { entries } } },
    );
  } else {
    writes.push(
      recordOne(context, {
        clientUuid: context.uuid(),
        status: 'done',
        playerId: row.player.id,
        testDefinitionId: station.definition.id,
        method,
        entries,
        ...(context.evaluatorId === null ? {} : { evaluatorId: context.evaluatorId }),
        ...(isStrength && exercise !== null ? { exercise } : {}),
        ...(station.definition.sameDeviceOnly && deviceId !== null ? { deviceId } : {}),
      }),
    );
  }
  return { kind: 'writes', writes, warnings };
}

/** Voids an attempt (every entry of it) with its reason: the correction of an append-only log. */
export function planVoid(
  context: WriteContext,
  row: PlayerStation,
  attempt: FieldAttempt,
  reason: string,
): PlannedWrites {
  const stop = blocked(context, row);
  if (stop !== null) return problem(stop);
  const text = reason.trim();
  if (text === '') return problem({ kind: 'changeReason' });
  const result = row.results.find((r) => r.attempts.some((a) => a.key === attempt.key));
  const entryIds = attempt.entries.filter((e) => e.voided === null).map((e) => e.id);
  if (result === undefined || entryIds.length === 0) return problem({ kind: 'empty' });
  return {
    kind: 'writes',
    warnings: [],
    writes: [
      {
        op: 'test_result.void_entries',
        input: { target: result.target, body: { entryIds, reason: text } },
      },
    ],
  };
}

/** Reasons the staff picks for «no realizado»; `injured` is shown as «No disponible» but medical. */
export const FIELD_NOT_DONE_REASONS = [
  'absent',
  'injured',
  'other',
] as const satisfies readonly TestNotDoneReason[];

/**
 * Records a player as not done: a `not_done` result when they have none,
 * or the correction of a `done` result without valid attempts (with a
 * reason, ADR 0030). A test that does not apply to the stage is recorded
 * only as `not_applicable_to_stage` (principle 3).
 */
export function planNotDone(
  context: WriteContext,
  row: PlayerStation,
  reason: TestNotDoneReason | null,
  note: string,
  changeReason = '',
): PlannedWrites {
  const stop = blocked(context, row);
  if (stop !== null) return problem(stop);
  if (reason === null) return problem({ kind: 'reason' });
  if (!row.applicable && reason !== 'not_applicable_to_stage') {
    return problem({ kind: 'notApplicable' });
  }
  const text = note.trim();
  if (reason === 'other' && text === '') return problem({ kind: 'note' });
  if (row.validAttemptCount > 0) return problem({ kind: 'hasAttempts' });
  if (row.primary !== null) {
    const why = changeReason.trim();
    if (why === '') return problem({ kind: 'changeReason' });
    // Every `done` result of the player (several evaluators), not only the
    // primary one: none of them has a valid attempt left.
    return {
      kind: 'writes',
      warnings: [],
      writes: row.results
        .filter((r) => r.status === 'done')
        .map((r) => ({
          op: 'test_result.update' as const,
          input: {
            target: r.target,
            body: {
              changeReason: why,
              status: 'not_done' as const,
              notDoneReason: reason,
              notDoneNote: text === '' ? null : text,
            },
          },
        })),
    };
  }
  if (row.notDone !== null) return problem({ kind: 'empty' });
  return {
    kind: 'writes',
    warnings: [],
    writes: [
      recordOne(context, {
        clientUuid: context.uuid(),
        status: 'not_done',
        playerId: row.player.id,
        testDefinitionId: context.station.definition.id,
        notDoneReason: reason,
        ...(text === '' ? {} : { notDoneNote: text }),
        ...(context.evaluatorId === null ? {} : { evaluatorId: context.evaluatorId }),
      }),
    ],
  };
}

/**
 * Every player the station does not apply to (principle 3) and who has
 * nothing recorded, as «No corresponde a la etapa», in one batch.
 */
function pendingNotApplicable(
  sheet: Pick<TestDaySheet, 'testSession'>,
  rows: readonly PlayerStation[],
): PlayerStation[] {
  if (sheet.testSession.status === 'cancelled') return [];
  return rows.filter(
    (r) => !r.applicable && r.state === 'empty' && r.player.recording === 'allowed',
  );
}

/** How many players {@link planNotApplicable} would record (no ids are drawn). */
export function notApplicableCount(
  sheet: Pick<TestDaySheet, 'testSession'>,
  rows: readonly PlayerStation[],
): number {
  return pendingNotApplicable(sheet, rows).length;
}

export function planNotApplicable(
  context: WriteContext,
  rows: readonly PlayerStation[],
): { readonly writes: readonly FieldWrite[]; readonly count: number } {
  const pending = pendingNotApplicable(context.sheet, rows);
  if (pending.length === 0) return { writes: [], count: 0 };
  return {
    count: pending.length,
    writes: [
      {
        op: 'test_session.record_results',
        input: {
          params: { testSessionId: context.sheet.testSession.id },
          body: {
            results: pending.map((r) => ({
              clientUuid: context.uuid(),
              status: 'not_done' as const,
              playerId: r.player.id,
              testDefinitionId: context.station.definition.id,
              notDoneReason: 'not_applicable_to_stage' as const,
              ...(context.evaluatorId === null ? {} : { evaluatorId: context.evaluatorId }),
            })),
          },
        },
      },
    ],
  };
}

export interface IftStageToRecord {
  readonly playerId: string;
  readonly lastCompletedStage: number;
}

/** A group of writes of the 30-15 station and the players whose stage it records. */
export interface IftStageStep {
  readonly playerIds: readonly string[];
  readonly writes: readonly FieldWrite[];
}

/**
 * The seam of the 30-15 IFT audio (B-507, #85): the last completed stage
 * of each player of a run, as the writes of the IFT station — one batch
 * creating a result with the `ift_stage` entry for whoever has none, one
 * more attempt for whoever has. Each step says whose stages it records, so
 * the run can keep track of what was queued if a later step fails. Players
 * that cannot be recorded here (not in the day, no consent, out of their
 * stage, recorded as not done) are returned with their stage, for the staff
 * to load by hand.
 */
export function planIftStages(
  context: WriteContext,
  rows: readonly PlayerStation[],
  stages: readonly IftStageToRecord[],
): { readonly steps: readonly IftStageStep[]; readonly skipped: readonly IftStageToRecord[] } {
  const steps: IftStageStep[] = [];
  const skipped: IftStageToRecord[] = [];
  const creates: TestSessionResultInput[] = [];
  const created: string[] = [];
  for (const stage of stages) {
    const row = rows.find((r) => r.player.id === stage.playerId);
    if (row === undefined) {
      skipped.push(stage);
      continue;
    }
    const planned = planAttempt(
      { ...context, settings: { ...context.settings, mode: 'ift_stage' } },
      row,
      { lastCompletedStage: String(stage.lastCompletedStage) },
    );
    if (planned.kind !== 'writes') {
      skipped.push(stage);
      continue;
    }
    const added: FieldWrite[] = [];
    for (const write of planned.writes) {
      if (write.op === 'test_session.record_results') creates.push(...write.input.body.results);
      else added.push(write);
    }
    if (added.length > 0) steps.push({ playerIds: [stage.playerId], writes: added });
    else created.push(stage.playerId);
  }
  if (creates.length > 0) {
    steps.unshift({
      playerIds: created,
      writes: [
        {
          op: 'test_session.record_results',
          input: {
            params: { testSessionId: context.sheet.testSession.id },
            body: { results: creates },
          },
        },
      ],
    });
  }
  return { steps, skipped };
}

/** The attempt values of a typed attempt (for the live preview while typing). */
export function typedAttemptValues(
  station: TestDaySheetStation,
  mode: EntryMode,
  values: Readonly<Record<string, string>>,
  player: Pick<TestDaySheetPlayer, 'strengthAssessment'>,
): { metricCode: string; value: number }[] {
  const parsed = parseAttempt(station, mode, values, player.strengthAssessment);
  return parsed.status === 'ok' ? attemptMetricValues(station, parsed) : [];
}
