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
  type Sex,
  type StrengthAssessment,
  type TestEntryInput,
  type TestNotDoneReason,
  type UnitCode,
} from '@sport-performance/domain';
import { parseNumber } from '@sport-performance/i18n';
import type { TestDaySheetStation } from '../endpoints/test-day-sheet.js';
import type { TestResult } from '../endpoints/tests.js';

/**
 * How a station of a test day is typed (ADR 0068), shared by the staff web
 * (B-405) and the field app (B-505) so both apply the same rules: the fields
 * of each entry mode, the parsing of an attempt (es-AR, decimal comma) into
 * the entries of the API, the scores and the best attempt with the same
 * domain formulas the server uses, and the plausibility warnings. Pure
 * functions over the sheet; the server scores again and decides.
 */

// ─── Not-done reasons as the viewer reads them ──────────────────────────────────────

/** A not-done reason as a viewer reads it: `injured` is `unavailable` for all but medical. */
export type NotDoneReasonView = TestNotDoneReason | 'unavailable';

/**
 * How a not-done reason is shown to the viewer (ADR 0029): `injured` reveals
 * a health condition, so every role but `medical` reads «No disponible». The
 * API already sends saved results that way; clients apply the same domain
 * rule again (to a saved result and to the options of a form), so a reason
 * never reaches a non-medical screen as «Lesionado/a».
 */
export function notDoneReasonView(reason: NotDoneReasonView, viewer: Role): NotDoneReasonView {
  return reason === 'unavailable' ? reason : notDoneReasonForViewer(reason, viewer);
}

// ─── Entry modes and fields ──────────────────────────────────────────────────────────

/** How a station is typed (video frames are their own flow, B-603). */
export type EntryMode =
  'sprint_splits' | 'cmj_flight_time' | 'ift_stage' | 'strength_set' | 'value';

export const TYPED_ENTRY_MODES: readonly EntryMode[] = [
  'sprint_splits',
  'cmj_flight_time',
  'ift_stage',
  'strength_set',
  'value',
];

/** Modes a station offers, the preferred first (the definition's order). */
export function entryModesOf(station: TestDaySheetStation): EntryMode[] {
  const kinds = station.definition.entryKinds;
  const modes = kinds.filter((kind): kind is EntryMode =>
    (TYPED_ENTRY_MODES as string[]).includes(kind),
  );
  // The sprint typed as plain values would lose the Vmax: always by splits.
  return kinds.includes('sprint_splits') ? modes.filter((mode) => mode !== 'value') : modes;
}

export interface FieldSpec {
  /** Key of the typed value and of its label (`testDay.field.<key>` or `testDay.metric.<key>`). */
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

/** Methods the staff picks for a result (`historical` is only for imports). */
export const STAFF_METHODS = [
  'manual',
  'photocell',
  'video',
  'app',
  'pod',
] as const satisfies readonly MeasurementMethod[];

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

/** The metric values of a parsed attempt, with the station's protocol parameters. */
export function attemptMetricValues(
  station: TestDaySheetStation,
  parsed: Extract<ParsedAttempt, { status: 'ok' }>,
): { metricCode: string; value: number }[] {
  const settings = testScoringSettings(station.definition.protocol.parameters);
  return parsed.entries.flatMap(({ entry }) =>
    scoreTestEntry(station.testCode, entry, settings).values.map((value) => ({
      metricCode: value.metricCode,
      value: value.value,
    })),
  );
}

// ─── Scores and best attempt ─────────────────────────────────────────────────────────

export interface PreviewScore {
  readonly metricCode: string;
  readonly value: number;
  readonly aggregation: 'best' | 'mean' | 'single';
}

/** One metric value of one attempt (`attemptNumber` 1-based). */
export interface AttemptMetricValue {
  readonly metricCode: string;
  readonly value: number;
  readonly attemptNumber: number;
}

export interface AttemptScores {
  readonly scores: readonly PreviewScore[];
  /** Best attempt (number) of each metric scored by `best`; absent for `mean` and neutral metrics. */
  readonly bestAttempt: ReadonlyMap<string, number>;
}

function directionOf(station: TestDaySheetStation, metricCode: string) {
  return station.definition.metrics.find((m) => m.code === metricCode)?.direction ?? 'neutral';
}

/**
 * The score of each metric from the values of the valid attempts, with the
 * result-level derived ones (such as the 505 asymmetry), and the best
 * attempt of each metric: the same domain rules the server applies.
 */
export function scoreAttemptValues(
  station: TestDaySheetStation,
  values: readonly AttemptMetricValue[],
): AttemptScores {
  const aggregationOf = (metricCode: string) => ({
    aggregation: station.definition.attemptAggregation,
    direction: directionOf(station, metricCode),
  });
  const scores: PreviewScore[] = scoreResultMetrics(values, aggregationOf).map((s) => ({
    metricCode: s.metricCode,
    value: s.value,
    aggregation: s.aggregation,
  }));
  const derived = deriveResultMetrics(
    station.testCode,
    new Map(scores.map((s) => [s.metricCode, s.value])),
  );
  for (const d of derived) {
    scores.push({ metricCode: d.metricCode, value: d.value, aggregation: 'single' });
  }

  const perMetric = new Map<string, AttemptMetricValue[]>();
  for (const value of values) {
    const list = perMetric.get(value.metricCode) ?? [];
    list.push(value);
    perMetric.set(value.metricCode, list);
  }
  const bestAttempt = new Map<string, number>();
  for (const [metricCode, list] of perMetric) {
    const rule = aggregationOf(metricCode);
    if (rule.aggregation !== 'best' || rule.direction === 'neutral') continue;
    const aggregate = aggregateAttempts(
      list.map((item) => item.value),
      { aggregation: 'best', direction: rule.direction },
    );
    const chosen = aggregate.selectedIndex === null ? undefined : list[aggregate.selectedIndex];
    if (chosen !== undefined) bestAttempt.set(metricCode, chosen.attemptNumber);
  }
  return { scores, bestAttempt };
}

// ─── Plausibility ────────────────────────────────────────────────────────────────────

export interface FieldPlausibilityWarning {
  readonly fieldKey: string;
  readonly metricCode: string;
  readonly value: number;
  readonly result: Extract<PlausibilityResult, { status: 'below' | 'above' }>;
}

/**
 * The plausibility warnings of one parsed attempt for the player's sex and
 * age on the day: each typed field in its metric (typed as is, or computed
 * from it, such as the CMJ height from the flight time). Advisory: the staff
 * may save it anyway.
 */
export function attemptPlausibilityWarnings(
  station: TestDaySheetStation,
  mode: EntryMode,
  parsed: ParsedAttempt,
  player: { readonly sex: Sex; readonly birthDate: LocalDate },
  day: LocalDate,
): FieldPlausibilityWarning[] {
  if (parsed.status !== 'ok') return [];
  const computed = mode === 'strength_set' ? [] : attemptMetricValues(station, parsed);
  const warnings: FieldPlausibilityWarning[] = [];
  const ageYears = decimalAgeYears(player.birthDate, day);
  for (const field of fieldsOf(station, mode)) {
    const typed = parsed.numbers[field.key];
    if (typed === undefined) continue;
    const typedIsMetric = mode === 'value' || mode === 'sprint_splits';
    const value = typedIsMetric
      ? typed
      : mode === 'strength_set'
        ? undefined
        : computed.find((item) => item.metricCode === field.metricCode)?.value;
    if (value === undefined || !isCanonicalMetricCode(field.metricCode)) continue;
    const result = checkPlausibleValue({
      metricCode: canonicalMetricCode(field.metricCode),
      value,
      sex: player.sex,
      ageYears,
    });
    if (result.status === 'below' || result.status === 'above') {
      warnings.push({ fieldKey: field.key, metricCode: field.metricCode, value, result });
    }
  }
  return warnings;
}

/** Next attempt number of a recorded result (or of several: attempts never collide). */
export function nextAttemptNumber(results: readonly Pick<TestResult, 'entries'>[]): number {
  let max = 0;
  for (const result of results) {
    for (const entry of result.entries) max = Math.max(max, entry.attemptNumber ?? 0);
  }
  return max + 1;
}
