import type {
  TestDaySheetPlayer,
  TestDaySheetStation,
  TestEntryInputPayload,
  TestResult,
  TestSessionResultInput,
  ValidationIssue,
} from '@sport-performance/contracts';
import {
  DomainValidationError,
  UNIT_CODES,
  aggregateAttempts,
  canonicalMetricCode,
  checkPlausibleValue,
  decimalAgeYears,
  deriveResultMetrics,
  isCanonicalMetricCode,
  notDoneReasonForViewer,
  scoreResultMetrics,
  scoreTestEntry,
  strengthMetricAllowed,
  testScoringSettings,
  type LocalDate,
  type MeasurementMethod,
  type PlausibilityResult,
  type Role,
  type StrengthAssessment,
  type TestEntryInput,
  type TestNotDoneReason,
  type UnitCode,
} from '@sport-performance/domain';
import { parseNumber } from '@sport-performance/i18n';

/**
 * The test day sheet as the staff types it (B-405): how each station is
 * entered (fields per attempt), the draft of each row, its parsing into the
 * entries of the API (ADR 0039), the preview of the scores with the same
 * domain formulas the server uses, the best attempt, the plausibility
 * warnings and the batch of a station. Pure functions, no React.
 */

// ─── Not-done reasons as the viewer reads them ──────────────────────────────────────

/** A not-done reason as a viewer reads it: `injured` is `unavailable` for all but medical. */
export type NotDoneReasonView = TestNotDoneReason | 'unavailable';

/**
 * How a not-done reason is shown to the viewer (ADR 0029): `injured` reveals
 * a health condition, so every role but `medical` reads «No disponible». The
 * API already sends saved results that way; the web applies the same domain
 * rule again (to a saved result and to the options of the form), so a
 * reason never reaches a non-medical screen as «Lesionado/a».
 */
export function notDoneReasonView(reason: NotDoneReasonView, viewer: Role): NotDoneReasonView {
  return reason === 'unavailable' ? reason : notDoneReasonForViewer(reason, viewer);
}

// ─── Entry modes and fields ──────────────────────────────────────────────────────────

/** How a station is entered on the web (video frames are entered in the field app, B-505). */
export type EntryMode =
  'sprint_splits' | 'cmj_flight_time' | 'ift_stage' | 'strength_set' | 'value';

const WEB_MODES: readonly EntryMode[] = [
  'sprint_splits',
  'cmj_flight_time',
  'ift_stage',
  'strength_set',
  'value',
];

/** Modes a station offers, the preferred first (the definition's order). */
export function entryModesOf(station: TestDaySheetStation): EntryMode[] {
  const kinds = station.definition.entryKinds;
  const modes = kinds.filter((kind): kind is EntryMode => (WEB_MODES as string[]).includes(kind));
  // The sprint typed as plain values would lose the Vmax: always by splits.
  return kinds.includes('sprint_splits') ? modes.filter((mode) => mode !== 'value') : modes;
}

export interface FieldSpec {
  /** Key of the draft value and of its label (`testDay.field.<key>`). */
  readonly key: string;
  /** Unit typed in; `null` for a stage number. */
  readonly unit: UnitCode | null;
  /** Metric the field's value scores (and highlights as the best attempt). */
  readonly metricCode: string;
  readonly integer: boolean;
  readonly optional: boolean;
}

function unitOf(unit: string): UnitCode | null {
  return (UNIT_CODES as readonly string[]).includes(unit) ? (unit as UnitCode) : null;
}

/** Metrics typed as plain values in a station: the ones that are not derived. */
export function valueMetricsOf(
  station: TestDaySheetStation,
): TestDaySheetStation['definition']['metrics'] {
  return station.definition.metrics.filter((metric) => !metric.derived);
}

export function fieldsOf(station: TestDaySheetStation, mode: EntryMode): FieldSpec[] {
  const field = (
    key: string,
    unit: UnitCode | null,
    metricCode: string,
    options: { integer?: boolean; optional?: boolean } = {},
  ): FieldSpec => ({
    key,
    unit,
    metricCode,
    integer: options.integer ?? false,
    optional: options.optional ?? false,
  });
  switch (mode) {
    case 'sprint_splits':
      return [
        field('split10S', 's', 'sprint_10_s', { optional: true }),
        field('split20S', 's', 'sprint_20_s'),
        field('split40S', 's', 'sprint_40_s'),
      ];
    case 'cmj_flight_time':
      return [field('flightTimeMsec', 'msec', 'cmj_height_cm')];
    case 'ift_stage':
      return [field('lastCompletedStage', null, 'vift_kmh', { integer: true })];
    case 'strength_set':
      return [
        field('loadKg', 'kg', 'e1rm_kg'),
        field('reps', 'n', 'e1rm_kg', { integer: true }),
        field('rir', 'n', 'e1rm_kg'),
      ];
    case 'value':
      return valueMetricsOf(station).map((metric) =>
        field(metric.code, unitOf(metric.unit), metric.code, {
          integer: metric.unit === 'n',
          // Several metrics in one attempt (505 sides, mobility sides): any of them.
          optional: true,
        }),
      );
  }
}

/** Whether a player may record a field (strength metrics depend on the assessment of the stage). */
export function fieldAllowed(
  field: FieldSpec,
  mode: EntryMode,
  assessment: StrengthAssessment | null,
): boolean {
  if (mode !== 'value' || assessment === null) return true;
  return strengthMetricAllowed(field.metricCode, assessment);
}

// ─── Drafts ──────────────────────────────────────────────────────────────────────────

/** Methods the staff picks on the web (`historical` is only for imports). */
export const WEB_METHODS = [
  'manual',
  'photocell',
  'video',
  'app',
  'pod',
] as const satisfies readonly MeasurementMethod[];

/** Default method of a station, as the mockup proposes for each test. */
export function defaultMethodOf(testCode: string): MeasurementMethod {
  switch (testCode) {
    case 'sprint_40':
    case 'cod_505':
      return 'photocell';
    case 'cmj':
      return 'video';
    case 'reaction':
      return 'app';
    default:
      return 'manual';
  }
}

export interface RowDraft {
  /** `clientUuid` of the result: the same on every retry, so the batch never duplicates. */
  readonly clientUuid: string;
  readonly status: 'done' | 'not_done';
  /** Typed text per attempt and field key (es-AR, decimal comma). */
  readonly attempts: readonly Readonly<Record<string, string>>[];
  /** `clientUuid` of each entry, per attempt and field key (or `entry` for raw kinds). */
  readonly entryUuids: readonly Readonly<Record<string, string>>[];
  readonly method: MeasurementMethod;
  readonly reason: TestNotDoneReason | null;
  readonly note: string;
  /**
   * The batch input of the row the first time it was sent (JSON), kept while
   * unconfirmed: a retry that comes back `replayed` with a different input
   * means the saved result lacks the edits made since.
   */
  readonly firstSent: string | null;
}

export function emptyDraft(
  attemptCount: number,
  method: MeasurementMethod,
  uuid: () => string = () => crypto.randomUUID(),
): RowDraft {
  return {
    clientUuid: uuid(),
    status: 'done',
    attempts: Array.from({ length: attemptCount }, () => ({})),
    entryUuids: Array.from({ length: attemptCount }, () => ({})),
    method,
    reason: null,
    note: '',
    firstSent: null,
  };
}

/** Something was typed or chosen in the row (worth saving or warning about). */
export function isDirty(draft: RowDraft): boolean {
  if (draft.status === 'not_done') return true;
  return draft.attempts.some((attempt) => Object.values(attempt).some((v) => v.trim() !== ''));
}

// ─── Parsing an attempt ──────────────────────────────────────────────────────────────

export type FieldProblem = 'number' | 'integer' | 'positive' | 'nonNegative' | 'required';

export type ParsedAttempt =
  | { readonly status: 'empty' }
  | {
      readonly status: 'invalid';
      readonly fieldKey: string | null;
      readonly problem: FieldProblem | 'domain';
    }
  | {
      readonly status: 'ok';
      /** The entries of the attempt, without `clientUuid` and `attemptNumber`. */
      readonly entries: readonly { readonly key: string; readonly entry: TestEntryInput }[];
      /** Parsed number of each typed field. */
      readonly numbers: Readonly<Record<string, number>>;
    };

function parseField(text: string, field: FieldSpec, mode: EntryMode): number | FieldProblem {
  const value = parseNumber(text, { allowGrouping: false });
  if (value === null) return 'number';
  if (field.integer && !Number.isInteger(value)) return 'integer';
  // A plain value may be 0 (0 pull-ups, 0 cm knee-to-wall), as the API and the
  // domain's plausible ranges accept; RIR may be 0 too (logged as a protocol
  // issue). The other raw fields (splits, flight time, stage, load, reps) are
  // positive measures.
  const zeroAllowed = mode === 'value' || field.key === 'rir';
  if (zeroAllowed) return value < 0 ? 'nonNegative' : value;
  if (value <= 0) return 'positive';
  return value;
}

/**
 * The entries of one attempt from what was typed. A field the player may not
 * record (strength by stage) is ignored. Raw kinds are checked with the
 * domain scoring, so a split that does not increase is caught before sending.
 */
export function parseAttempt(
  station: TestDaySheetStation,
  mode: EntryMode,
  values: Readonly<Record<string, string>>,
  assessment: StrengthAssessment | null = null,
): ParsedAttempt {
  const fields = fieldsOf(station, mode).filter((f) => fieldAllowed(f, mode, assessment));
  const typed = fields.filter((f) => (values[f.key] ?? '').trim() !== '');
  if (typed.length === 0) return { status: 'empty' };
  const numbers: Record<string, number> = {};
  for (const field of typed) {
    const parsed = parseField(values[field.key] ?? '', field, mode);
    if (typeof parsed === 'string')
      return { status: 'invalid', fieldKey: field.key, problem: parsed };
    numbers[field.key] = parsed;
  }
  if (mode !== 'value') {
    const missing = fields.find((f) => !f.optional && numbers[f.key] === undefined);
    if (missing !== undefined)
      return { status: 'invalid', fieldKey: missing.key, problem: 'required' };
  }
  const n = (key: string) => numbers[key] ?? 0;
  let entries: { key: string; entry: TestEntryInput }[];
  switch (mode) {
    case 'sprint_splits':
      entries = [
        {
          key: 'entry',
          entry: {
            kind: 'sprint_splits',
            ...(numbers.split10S === undefined ? {} : { split10S: numbers.split10S }),
            split20S: n('split20S'),
            split40S: n('split40S'),
          },
        },
      ];
      break;
    case 'cmj_flight_time':
      entries = [
        {
          key: 'entry',
          entry: { kind: 'cmj_flight_time', flightTimeS: n('flightTimeMsec') / 1000 },
        },
      ];
      break;
    case 'ift_stage':
      entries = [
        { key: 'entry', entry: { kind: 'ift_stage', lastCompletedStage: n('lastCompletedStage') } },
      ];
      break;
    case 'strength_set':
      entries = [
        {
          key: 'entry',
          entry: { kind: 'strength_set', loadKg: n('loadKg'), reps: n('reps'), rir: n('rir') },
        },
      ];
      break;
    case 'value':
      entries = typed.map((field) => ({
        key: field.key,
        entry: { kind: 'value', metricCode: field.metricCode, value: n(field.key) },
      }));
      break;
  }
  const settings = testScoringSettings(station.definition.protocol.parameters);
  for (const { entry } of entries) {
    try {
      scoreTestEntry(station.testCode, entry, settings);
    } catch (error) {
      if (error instanceof DomainValidationError) {
        return { status: 'invalid', fieldKey: null, problem: 'domain' };
      }
      throw error;
    }
  }
  return { status: 'ok', entries, numbers };
}

// ─── Preview: scores, best attempt, plausibility ─────────────────────────────────────

export interface PreviewScore {
  readonly metricCode: string;
  readonly value: number;
  readonly aggregation: 'best' | 'mean' | 'single';
}

export interface RowPreview {
  readonly attempts: readonly ParsedAttempt[];
  readonly scores: readonly PreviewScore[];
  /** Best attempt (index) of each metric scored by `best`; absent for `mean`. */
  readonly bestAttempt: ReadonlyMap<string, number>;
  /** Advisory warnings: out of the plausible range, by attempt and field key. */
  readonly warnings: readonly PlausibilityWarning[];
}

export interface PlausibilityWarning {
  readonly attempt: number;
  readonly fieldKey: string;
  readonly metricCode: string;
  readonly value: number;
  readonly result: Extract<PlausibilityResult, { status: 'below' | 'above' }>;
}

function directionOf(station: TestDaySheetStation, metricCode: string) {
  return station.definition.metrics.find((m) => m.code === metricCode)?.direction ?? 'neutral';
}

/**
 * The preview of a row with the domain formulas: every attempt parsed, the
 * score of each metric (with the result-level derived ones, such as the 505
 * asymmetry), the best attempt of each metric and the plausibility warnings
 * for the player's sex and age on the day. Never blocks: the server decides.
 */
export function previewRow(
  station: TestDaySheetStation,
  mode: EntryMode,
  draft: RowDraft,
  player: Pick<TestDaySheetPlayer, 'sex' | 'birthDate' | 'strengthAssessment'>,
  day: LocalDate,
): RowPreview {
  const attempts = draft.attempts.map((values) =>
    parseAttempt(station, mode, values, player.strengthAssessment),
  );
  const settings = testScoringSettings(station.definition.protocol.parameters);
  const perMetric = new Map<string, { attempt: number; value: number }[]>();
  const valuesByAttempt: { metricCode: string; value: number; attemptNumber: number }[] = [];
  attempts.forEach((parsed, index) => {
    if (parsed.status !== 'ok') return;
    for (const { entry } of parsed.entries) {
      for (const value of scoreTestEntry(station.testCode, entry, settings).values) {
        valuesByAttempt.push({ ...value, attemptNumber: index + 1 });
        const list = perMetric.get(value.metricCode) ?? [];
        list.push({ attempt: index, value: value.value });
        perMetric.set(value.metricCode, list);
      }
    }
  });
  const aggregationOf = (metricCode: string) => ({
    aggregation: station.definition.attemptAggregation,
    direction: directionOf(station, metricCode),
  });
  const scores: PreviewScore[] = scoreResultMetrics(valuesByAttempt, aggregationOf).map((s) => ({
    metricCode: s.metricCode,
    value: s.value,
    aggregation: s.aggregation,
  }));
  const derived = deriveResultMetrics(
    station.testCode,
    new Map(scores.map((s) => [s.metricCode, s.value])),
  );
  for (const d of derived)
    scores.push({ metricCode: d.metricCode, value: d.value, aggregation: 'single' });

  const bestAttempt = new Map<string, number>();
  for (const [metricCode, list] of perMetric) {
    const rule = aggregationOf(metricCode);
    if (rule.aggregation !== 'best' || rule.direction === 'neutral') continue;
    const aggregate = aggregateAttempts(
      list.map((item) => item.value),
      { aggregation: 'best', direction: rule.direction },
    );
    const chosen = aggregate.selectedIndex === null ? undefined : list[aggregate.selectedIndex];
    if (chosen !== undefined) bestAttempt.set(metricCode, chosen.attempt);
  }

  const warnings: PlausibilityWarning[] = [];
  const ageYears = decimalAgeYears(player.birthDate, day);
  const fields = fieldsOf(station, mode);
  attempts.forEach((parsed, index) => {
    if (parsed.status !== 'ok') return;
    for (const field of fields) {
      const typed = parsed.numbers[field.key];
      if (typed === undefined) continue;
      // The value of the field in its metric: typed as is, or computed from it (CMJ, IFT).
      const typedIsMetric = mode === 'value' || mode === 'sprint_splits';
      const value = typedIsMetric
        ? typed
        : mode === 'strength_set'
          ? undefined
          : perMetric.get(field.metricCode)?.find((item) => item.attempt === index)?.value;
      if (value === undefined || !isCanonicalMetricCode(field.metricCode)) continue;
      const result = checkPlausibleValue({
        metricCode: canonicalMetricCode(field.metricCode),
        value,
        sex: player.sex,
        ageYears,
      });
      if (result.status === 'below' || result.status === 'above') {
        warnings.push({
          attempt: index,
          fieldKey: field.key,
          metricCode: field.metricCode,
          value,
          result,
        });
      }
    }
  });
  return { attempts, scores, bestAttempt, warnings };
}

// ─── The batch of a station ──────────────────────────────────────────────────────────

export interface StationContext {
  readonly station: TestDaySheetStation;
  readonly mode: EntryMode;
  /** Strength exercise of the station (`snake_case`), required by the API for strength. */
  readonly exercise: string | null;
  readonly deviceId: string | null;
}

export type RowProblem =
  | {
      readonly kind: 'attempt';
      readonly attempt: number;
      readonly fieldKey: string | null;
      readonly problem: FieldProblem | 'domain';
    }
  | { readonly kind: 'note' }
  | { readonly kind: 'reason' }
  | { readonly kind: 'exercise' }
  | { readonly kind: 'device' };

/** Draft entries of one attempt with their stable `clientUuid`s. */
function entriesOf(
  parsed: Extract<ParsedAttempt, { status: 'ok' }>,
  attempt: number,
  uuids: Readonly<Record<string, string>>,
  uuid: () => string,
): { entries: TestEntryInputPayload[]; uuids: Record<string, string> } {
  const next: Record<string, string> = { ...uuids };
  const entries = parsed.entries.map(({ key, entry }) => {
    const clientUuid = (next[key] ??= uuid());
    return { ...entry, clientUuid, attemptNumber: attempt + 1 };
  });
  return { entries, uuids: next };
}

export type BuiltRow =
  | { readonly kind: 'skip' }
  | { readonly kind: 'problems'; readonly problems: readonly RowProblem[] }
  | {
      readonly kind: 'result';
      readonly input: TestSessionResultInput;
      /** The draft with the `clientUuid`s it used (kept for a retry). */
      readonly draft: RowDraft;
    };

/**
 * One result of the batch from a row: `skip` when nothing was typed, the
 * problems to fix, or the result with stable `clientUuid`s.
 */
export function buildRow(
  context: StationContext,
  player: Pick<TestDaySheetPlayer, 'id' | 'strengthAssessment'>,
  draft: RowDraft,
  uuid: () => string = () => crypto.randomUUID(),
): BuiltRow {
  const { station, mode } = context;
  const definitionId = station.definition.id;
  if (draft.status === 'not_done') {
    if (draft.reason === null) return { kind: 'problems', problems: [{ kind: 'reason' }] };
    const note = draft.note.trim();
    if (draft.reason === 'other' && note === '')
      return { kind: 'problems', problems: [{ kind: 'note' }] };
    return {
      kind: 'result',
      draft,
      input: {
        clientUuid: draft.clientUuid,
        status: 'not_done',
        playerId: player.id,
        testDefinitionId: definitionId,
        notDoneReason: draft.reason,
        ...(note === '' ? {} : { notDoneNote: note }),
      },
    };
  }
  const problems: RowProblem[] = [];
  const entries: TestEntryInputPayload[] = [];
  const entryUuids: Record<string, string>[] = [];
  draft.attempts.forEach((values, attempt) => {
    const parsed = parseAttempt(station, mode, values, player.strengthAssessment);
    const uuids = draft.entryUuids[attempt] ?? {};
    if (parsed.status === 'invalid') {
      problems.push({
        kind: 'attempt',
        attempt,
        fieldKey: parsed.fieldKey,
        problem: parsed.problem,
      });
      entryUuids.push({ ...uuids });
      return;
    }
    if (parsed.status === 'empty') {
      entryUuids.push({ ...uuids });
      return;
    }
    const built = entriesOf(parsed, attempt, uuids, uuid);
    entries.push(...built.entries);
    entryUuids.push(built.uuids);
  });
  if (problems.length > 0) return { kind: 'problems', problems };
  if (entries.length === 0) return { kind: 'skip' };
  if (station.testCode === 'strength' && context.exercise === null)
    problems.push({ kind: 'exercise' });
  if (station.definition.sameDeviceOnly && context.deviceId === null)
    problems.push({ kind: 'device' });
  if (problems.length > 0) return { kind: 'problems', problems };
  return {
    kind: 'result',
    draft: { ...draft, entryUuids },
    input: {
      clientUuid: draft.clientUuid,
      status: 'done',
      playerId: player.id,
      testDefinitionId: definitionId,
      method: draft.method,
      entries,
      ...(context.exercise === null || station.testCode !== 'strength'
        ? {}
        : { exercise: context.exercise }),
      ...(station.definition.sameDeviceOnly && context.deviceId !== null
        ? { deviceId: context.deviceId }
        : {}),
    },
  };
}

/** Entries to add to a recorded result (one more attempt), with their `clientUuid`s. */
export function buildAddedAttempt(
  context: StationContext,
  player: Pick<TestDaySheetPlayer, 'strengthAssessment'>,
  values: Readonly<Record<string, string>>,
  attemptNumber: number,
  uuids: Readonly<Record<string, string>>,
  uuid: () => string = () => crypto.randomUUID(),
):
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'invalid';
      readonly fieldKey: string | null;
      readonly problem: FieldProblem | 'domain';
    }
  | {
      readonly kind: 'entries';
      readonly entries: TestEntryInputPayload[];
      readonly uuids: Record<string, string>;
    } {
  const parsed = parseAttempt(context.station, context.mode, values, player.strengthAssessment);
  if (parsed.status === 'empty') return { kind: 'empty' };
  if (parsed.status === 'invalid')
    return { kind: 'invalid', fieldKey: parsed.fieldKey, problem: parsed.problem };
  const built = entriesOf(parsed, attemptNumber - 1, uuids, uuid);
  return { kind: 'entries', ...built };
}

/** Next attempt number of a recorded result. */
export function nextAttemptNumber(result: Pick<TestResult, 'entries'>): number {
  return result.entries.reduce((max, entry) => Math.max(max, entry.attemptNumber ?? 0), 0) + 1;
}

// ─── Errors of a batch, back to its rows ─────────────────────────────────────────────

/** What a validation issue of the batch is about, for the row's message. */
export type IssueTopic =
  | 'stage'
  | 'entries'
  | 'method'
  | 'device'
  | 'exercise'
  | 'note'
  | 'player'
  | 'definition'
  | 'other';

export function issueTopic(issue: ValidationIssue): IssueTopic {
  const field = issue.path[3];
  if (
    field === 'status' &&
    (issue.code === 'not_in_battery' || issue.code === 'maximal_load_not_allowed')
  ) {
    return 'stage';
  }
  switch (field) {
    case 'entries':
      return 'entries';
    case 'method':
      return 'method';
    case 'deviceId':
      return 'device';
    case 'exercise':
      return 'exercise';
    case 'notDoneNote':
      return 'note';
    case 'playerId':
      return 'player';
    case 'testDefinitionId':
      return 'definition';
    default:
      return 'other';
  }
}

/** A validation issue of the batch on its row: the topic and, for an entry, its attempt and field. */
export interface RowIssue {
  readonly topic: IssueTopic;
  /** Attempt (1-based) of the entry the issue is about, when it is about one. */
  readonly attemptNumber: number | null;
  /** Field key of the sheet (a metric code in value mode, a raw field otherwise). */
  readonly fieldKey: string | null;
}

/** Field key of the sheet for a property of a raw entry (the flight time is typed in ms). */
function sheetFieldKey(property: string | number | undefined): string | null {
  if (typeof property !== 'string') return null;
  return property === 'flightTimeS' ? 'flightTimeMsec' : property;
}

function rowIssueOf(issue: ValidationIssue, sent: TestSessionResultInput | undefined): RowIssue {
  const topic = issueTopic(issue);
  const entryIndex = issue.path[4];
  if (topic !== 'entries' || typeof entryIndex !== 'number' || sent?.status !== 'done') {
    return { topic, attemptNumber: null, fieldKey: null };
  }
  const entry = sent.entries[entryIndex];
  if (entry === undefined) return { topic, attemptNumber: null, fieldKey: null };
  const property = issue.path[5];
  return {
    topic,
    attemptNumber: entry.attemptNumber ?? null,
    fieldKey:
      entry.kind === 'value'
        ? entry.metricCode
        : property === 'kind'
          ? null
          : sheetFieldKey(property),
  };
}

/**
 * The issues of `POST …/results`, by player of the batch (`body.results[i]`
 * is the i-th row sent); an issue of an entry (`…entries[j]`) goes back to
 * its attempt and field through the entry sent. Issues of the request itself
 * go under `null`.
 */
export function issuesByPlayer(
  issues: readonly ValidationIssue[],
  sent: readonly { readonly playerId: string; readonly input: TestSessionResultInput }[],
): Map<string | null, RowIssue[]> {
  const result = new Map<string | null, RowIssue[]>();
  for (const issue of issues) {
    const [root, list, index] = issue.path;
    const row =
      root === 'body' && list === 'results' && typeof index === 'number' ? sent[index] : undefined;
    const playerId = row?.playerId ?? null;
    const rowIssues = result.get(playerId) ?? [];
    const next = rowIssueOf(issue, row?.input);
    if (
      !rowIssues.some(
        (other) =>
          other.topic === next.topic &&
          other.attemptNumber === next.attemptNumber &&
          other.fieldKey === next.fieldKey,
      )
    ) {
      rowIssues.push(next);
    }
    result.set(playerId, rowIssues);
  }
  return result;
}
