import type { AgeBand } from '../category.js';
import type { CanonicalMetricCode, CanonicalTestCode, MetricDirection } from '../codes.js';
import { memberGuard } from '../enum.js';
import type { MeasurementMethod } from '../measurement.js';
import type { Sex } from '../sex.js';
import type { Sport } from '../sport.js';
import type { Stage, StrengthAssessment } from '../stage.js';
import { maximalLoadTestsAllowed } from '../stage-rules.js';
import { compareLocalDates, type LocalDate } from '../time.js';
import { STANDARD_GRAVITY_MS2 } from '../units.js';
import { aggregateAttempts, type AttemptAggregation } from './attempts.js';
import { cmjHeightCmFromFlightTimeS, flightTimeSFromFrames } from './cmj.js';
import { cod505AsymmetryPct } from './cod505.js';
import { DEFAULT_IFT_3015_PROTOCOL, vift3015Kmh, type Ift3015Protocol } from './ift3015.js';
import { assertSprint40Splits, sprintVmaxMs } from './sprint.js';
import {
  DEFAULT_E1RM_PROTOCOL,
  e1rmSetIssues,
  epleyE1rmKg,
  relativeStrengthKgKg,
  type E1rmProtocol,
  type E1rmSetIssue,
} from './strength.js';
import { assertFinite, invalidArgument } from './validate.js';

/**
 * Recording test results (B-320): what the evaluator types in the field (raw
 * entries), the metric values the server computes from them with the scoring
 * formulas of this module, the result-level derived metrics, the score of
 * each metric, the stage rules of the battery and the warnings when results
 * measured differently are compared (principle 4).
 */

// ─── Raw entries ─────────────────────────────────────────────────────────────────────

/**
 * Kinds of raw entry. `value` is a metric value typed as is (in the metric's
 * unit); the rest are the raw inputs of a canonical test, scored here.
 */
export const TEST_ENTRY_KINDS = [
  'value',
  'sprint_splits',
  'cmj_flight_time',
  'cmj_video_frames',
  'ift_stage',
  'strength_set',
] as const;
export type TestEntryKind = (typeof TEST_ENTRY_KINDS)[number];
export const isTestEntryKind = memberGuard(TEST_ENTRY_KINDS);

/** One attempt (or one single measurement) as the evaluator records it. */
export type TestEntryInput =
  | { readonly kind: 'value'; readonly metricCode: string; readonly value: number }
  | {
      readonly kind: 'sprint_splits';
      readonly split10S?: number | undefined;
      readonly split20S: number;
      readonly split40S: number;
    }
  | { readonly kind: 'cmj_flight_time'; readonly flightTimeS: number }
  | {
      readonly kind: 'cmj_video_frames';
      readonly takeoffFrame: number;
      readonly landingFrame: number;
      readonly frameRateFps: number;
    }
  | { readonly kind: 'ift_stage'; readonly lastCompletedStage: number }
  | {
      readonly kind: 'strength_set';
      readonly loadKg: number;
      readonly reps: number;
      readonly rir: number;
    };

/**
 * Raw entry kinds each canonical test takes. Tests of the club that are not
 * canonical take `value` only. Anthropometry is a measurement of its own
 * (`anthro_measurement`), never a test result.
 */
export const TEST_ENTRY_KINDS_BY_TEST: Readonly<
  Record<CanonicalTestCode, readonly TestEntryKind[]>
> = {
  anthro: [],
  sprint_40: ['sprint_splits', 'value'],
  cmj: ['cmj_flight_time', 'cmj_video_frames', 'value'],
  cod_505: ['value'],
  ift_3015: ['ift_stage', 'value'],
  bronco: ['value'],
  strength: ['strength_set', 'value'],
  mobility: ['value'],
  reaction: ['value'],
  neck: ['value'],
};

function isCanonicalTest(code: string): code is CanonicalTestCode {
  return Object.hasOwn(TEST_ENTRY_KINDS_BY_TEST, code);
}

/** Entry kinds a test (canonical or of the club) accepts. */
export function entryKindsOfTest(testCode: string): readonly TestEntryKind[] {
  return isCanonicalTest(testCode) ? TEST_ENTRY_KINDS_BY_TEST[testCode] : ['value'];
}

/**
 * Settings of a protocol version the scoring depends on, read from
 * `test_definition.protocol.parameters` (seeded from the domain defaults,
 * B-306). Missing or malformed settings fall back to the defaults.
 */
export interface TestScoringSettings {
  readonly gravityMs2: number;
  readonly ift: Ift3015Protocol;
  readonly e1rm: E1rmProtocol;
}

export const DEFAULT_TEST_SCORING_SETTINGS: TestScoringSettings = {
  gravityMs2: STANDARD_GRAVITY_MS2,
  ift: DEFAULT_IFT_3015_PROTOCOL,
  e1rm: DEFAULT_E1RM_PROTOCOL,
};

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function integerAtLeast(value: unknown, min: number, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min
    ? value
    : fallback;
}

/** {@link TestScoringSettings} of a protocol's `parameters`. */
export function testScoringSettings(
  parameters: Readonly<Record<string, unknown>> | null | undefined,
): TestScoringSettings {
  const p = parameters ?? {};
  const d = DEFAULT_TEST_SCORING_SETTINGS;
  const minReps = integerAtLeast(p.e1rmMinReps, 1, d.e1rm.minReps);
  const maxReps = integerAtLeast(p.e1rmMaxReps, 1, d.e1rm.maxReps);
  const minRir =
    typeof p.e1rmMinRir === 'number' && p.e1rmMinRir >= 0 ? p.e1rmMinRir : d.e1rm.minRir;
  return {
    gravityMs2: positiveNumber(p.gravityMs2, d.gravityMs2),
    ift: {
      initialSpeedKmh: positiveNumber(p.initialSpeedKmh, d.ift.initialSpeedKmh),
      stageIncrementKmh: positiveNumber(p.stageIncrementKmh, d.ift.stageIncrementKmh),
      stageDurationS: positiveNumber(p.stageDurationS, d.ift.stageDurationS),
    },
    e1rm: maxReps >= minReps ? { minReps, maxReps, minRir } : { ...d.e1rm },
  };
}

/** A metric value computed from an entry. */
export interface EntryMetricValue {
  readonly metricCode: string;
  readonly value: number;
  /** Computed by the server (Vmax, height from flight time, e1RM), not typed in. */
  readonly computed: boolean;
}

export interface ScoredEntry {
  readonly values: readonly EntryMetricValue[];
  /** Advisory protocol issues (an e1RM set outside 3–5 reps or RIR < 2). Never block. */
  readonly issues: readonly E1rmSetIssue[];
}

/**
 * Scores one raw entry of a test: the metric values it produces, with the
 * formulas of the domain and the settings of the protocol version.
 *
 * @throws DomainValidationError when the kind does not belong to the test or
 *   the raw values are invalid (splits that do not increase, a landing before
 *   the take-off, a stage below 1…).
 */
export function scoreTestEntry(
  testCode: string,
  entry: TestEntryInput,
  settings: TestScoringSettings = DEFAULT_TEST_SCORING_SETTINGS,
): ScoredEntry {
  if (!entryKindsOfTest(testCode).includes(entry.kind)) {
    invalidArgument(`The test ${testCode} does not take "${entry.kind}" entries.`, entry.kind);
  }
  switch (entry.kind) {
    case 'value':
      assertFinite('value', entry.value);
      return {
        values: [{ metricCode: entry.metricCode, value: entry.value, computed: false }],
        issues: [],
      };
    case 'sprint_splits': {
      const splits = {
        ...(entry.split10S !== undefined && { split10S: entry.split10S }),
        split20S: entry.split20S,
        split40S: entry.split40S,
      };
      assertSprint40Splits(splits);
      const values: EntryMetricValue[] = [];
      if (entry.split10S !== undefined) {
        values.push({ metricCode: 'sprint_10_s', value: entry.split10S, computed: false });
      }
      values.push(
        { metricCode: 'sprint_20_s', value: entry.split20S, computed: false },
        { metricCode: 'sprint_40_s', value: entry.split40S, computed: false },
        { metricCode: 'sprint_vmax_ms', value: sprintVmaxMs(splits), computed: true },
      );
      return { values, issues: [] };
    }
    case 'cmj_flight_time':
      return {
        values: [
          {
            metricCode: 'cmj_height_cm',
            value: cmjHeightCmFromFlightTimeS(entry.flightTimeS, settings.gravityMs2),
            computed: true,
          },
        ],
        issues: [],
      };
    case 'cmj_video_frames':
      return {
        values: [
          {
            metricCode: 'cmj_height_cm',
            value: cmjHeightCmFromFlightTimeS(flightTimeSFromFrames(entry), settings.gravityMs2),
            computed: true,
          },
        ],
        issues: [],
      };
    case 'ift_stage':
      return {
        values: [
          {
            metricCode: 'vift_kmh',
            value: vift3015Kmh(entry.lastCompletedStage, settings.ift),
            computed: true,
          },
        ],
        issues: [],
      };
    case 'strength_set': {
      const set = { loadKg: entry.loadKg, reps: entry.reps, rir: entry.rir };
      return {
        values: [{ metricCode: 'e1rm_kg', value: epleyE1rmKg(set), computed: true }],
        issues: e1rmSetIssues(set, settings.e1rm),
      };
    }
  }
}

// ─── Scores and result-level derived metrics ─────────────────────────────────────────

/** A valid (not voided) value of a result, in recording order. */
export interface ResultMetricValue {
  readonly metricCode: string;
  readonly value: number;
  /** `null` for a result-level value (single measurement, derived, historical). */
  readonly attemptNumber: number | null;
}

export interface MetricScoringRule {
  readonly aggregation: AttemptAggregation;
  readonly direction: MetricDirection;
}

export interface MetricScore {
  readonly metricCode: string;
  readonly value: number;
  /** `single`: the result-level value; otherwise how the attempts were reduced. */
  readonly aggregation: AttemptAggregation | 'single';
  readonly attemptCount: number;
}

/**
 * The score of each metric of a result: its result-level value when there is
 * one, otherwise its attempts reduced with the aggregation of the test
 * definition and the direction of the metric (`best` falls back to `mean`
 * for a metric without a direction of improvement). Metrics in first-seen
 * order.
 */
export function scoreResultMetrics(
  values: readonly ResultMetricValue[],
  ruleOf: (metricCode: string) => MetricScoringRule,
): MetricScore[] {
  const byMetric = new Map<string, ResultMetricValue[]>();
  for (const row of values) {
    const list = byMetric.get(row.metricCode);
    if (list === undefined) byMetric.set(row.metricCode, [row]);
    else list.push(row);
  }
  const scores: MetricScore[] = [];
  for (const [metricCode, rows] of byMetric) {
    const single = rows.find((row) => row.attemptNumber === null);
    if (single !== undefined) {
      scores.push({ metricCode, value: single.value, aggregation: 'single', attemptCount: 1 });
      continue;
    }
    const rule = ruleOf(metricCode);
    const aggregation =
      rule.aggregation === 'best' && rule.direction === 'neutral' ? 'mean' : rule.aggregation;
    const aggregate = aggregateAttempts(
      rows.map((row) => row.value),
      { aggregation, direction: rule.direction },
    );
    scores.push({
      metricCode,
      value: aggregate.value,
      aggregation,
      attemptCount: aggregate.attemptCount,
    });
  }
  return scores;
}

/** Context of a result for its result-level derived metrics. */
export interface ResultDerivationContext {
  /** Body mass measured closest before (or on) the test day, for relative strength. */
  readonly bodyMassKg?: number | null;
}

/**
 * Result-level metrics derived from the scores of other metrics of the same
 * result, never typed in: the 505 asymmetry from the best time of each side,
 * and relative strength from the best load (1RM, else e1RM, else 3RM) and the
 * body mass. A metric whose inputs are missing is not derived.
 */
export function deriveResultMetrics(
  testCode: string,
  scores: ReadonlyMap<string, number>,
  context: ResultDerivationContext = {},
): { metricCode: CanonicalMetricCode; value: number }[] {
  const derived: { metricCode: CanonicalMetricCode; value: number }[] = [];
  if (testCode === 'cod_505') {
    const leftS = scores.get('cod505_left_s');
    const rightS = scores.get('cod505_right_s');
    if (leftS !== undefined && rightS !== undefined) {
      derived.push({
        metricCode: 'cod505_asymmetry_pct',
        value: cod505AsymmetryPct({ leftS, rightS }),
      });
    }
  }
  if (testCode === 'strength') {
    const loadKg = scores.get('rm1_kg') ?? scores.get('e1rm_kg') ?? scores.get('rm3_kg');
    const bodyMassKg = context.bodyMassKg ?? null;
    if (loadKg !== undefined && bodyMassKg !== null && bodyMassKg > 0) {
      derived.push({
        metricCode: 'relative_strength_kg_kg',
        value: relativeStrengthKgKg({ loadKg, bodyMassKg }),
      });
    }
  }
  return derived;
}

/** Metrics {@link deriveResultMetrics} computes, by test. */
export const RESULT_LEVEL_DERIVED_METRICS: Readonly<
  Record<string, readonly CanonicalMetricCode[]>
> = {
  cod_505: ['cod505_asymmetry_pct'],
  strength: ['relative_strength_kg_kg'],
};

// ─── Stage rules of the battery (principle 3) ────────────────────────────────────────

/**
 * Strength metrics each assessment records (CLAUDE.md, "Etapas"):
 * bodyweight reps and the technique score always; the estimated 1RM from
 * M15/M16; the direct 1RM or 3RM only where maximal loads are allowed.
 */
export const STRENGTH_METRICS_BY_ASSESSMENT: Readonly<
  Record<StrengthAssessment, readonly CanonicalMetricCode[]>
> = {
  technique_reps: ['pushups_n', 'pullups_n', 'plank_s', 'technique_score'],
  estimated_rm: [
    'pushups_n',
    'pullups_n',
    'plank_s',
    'technique_score',
    'e1rm_kg',
    'relative_strength_kg_kg',
  ],
  direct_rm: [
    'pushups_n',
    'pullups_n',
    'plank_s',
    'technique_score',
    'e1rm_kg',
    'rm1_kg',
    'rm3_kg',
    'relative_strength_kg_kg',
  ],
};

const ALL_STRENGTH_METRICS = new Set<string>(STRENGTH_METRICS_BY_ASSESSMENT.direct_rm);

/**
 * Whether a strength metric may be recorded for a player assessed with
 * `assessment` (from `strengthAssessmentFor`). Metrics that are not
 * canonical strength metrics are not restricted here.
 */
export function strengthMetricAllowed(metricCode: string, assessment: StrengthAssessment): boolean {
  if (!ALL_STRENGTH_METRICS.has(metricCode)) return true;
  return (STRENGTH_METRICS_BY_ASSESSMENT[assessment] as readonly string[]).includes(metricCode);
}

/** A row of `battery_config`: `null` scope fields mean any. */
export interface BatteryRow {
  readonly sport: Sport;
  readonly sex: Sex | null;
  readonly stage: Stage | null;
  readonly categoryId: string | null;
  readonly testCode: string;
  readonly validFrom: LocalDate;
  readonly validTo: LocalDate | null;
}

export interface BatteryPlayer {
  readonly sport: Sport;
  readonly sex: Sex;
  readonly stage: Stage;
  readonly categoryId: string;
}

/**
 * Whether the battery in effect on `on` (inclusive `validFrom`, exclusive
 * `validTo`) has the test for the player's sport, sex, stage and category.
 */
export function batteryIncludesTest(
  rows: readonly BatteryRow[],
  testCode: string,
  player: BatteryPlayer,
  on: LocalDate,
): boolean {
  return rows.some(
    (row) =>
      row.testCode === testCode &&
      row.sport === player.sport &&
      (row.sex === null || row.sex === player.sex) &&
      (row.stage === null || row.stage === player.stage) &&
      (row.categoryId === null || row.categoryId === player.categoryId) &&
      compareLocalDates(row.validFrom, on) <= 0 &&
      (row.validTo === null || compareLocalDates(on, row.validTo) < 0),
  );
}

export const TEST_NOT_APPLICABLE_REASONS = ['not_in_battery', 'maximal_load_not_allowed'] as const;
export type TestNotApplicableReason = (typeof TEST_NOT_APPLICABLE_REASONS)[number];

export type TestApplicability =
  | { readonly applicable: true }
  | { readonly applicable: false; readonly reason: TestNotApplicableReason };

/**
 * Whether a player may do a test version (principle 3, "cada etapa mide lo
 * que puede entrenar"): it is in the battery of their stage and, if it is a
 * maximal loaded test, both the stage and the age band allow maximal loads.
 * A test that does not apply is recorded as `not_done` with
 * `not_applicable_to_stage`.
 */
export function testApplicability(input: {
  readonly inBattery: boolean;
  readonly maximalLoad: boolean;
  readonly stage: Stage;
  readonly ageBand: Pick<AgeBand, 'maximalLoadTestsForPlayers'>;
}): TestApplicability {
  if (!input.inBattery) return { applicable: false, reason: 'not_in_battery' };
  if (input.maximalLoad && !maximalLoadTestsAllowed(input.stage, input.ageBand)) {
    return { applicable: false, reason: 'maximal_load_not_allowed' };
  }
  return { applicable: true };
}

// ─── Comparing results (principle 4) ─────────────────────────────────────────────────

/**
 * Why two results of a metric are not directly comparable: measured with
 * different methods (manual vs photocell vs historical), with different
 * protocol versions, for tests compared only on the same equipment (such as
 * reaction) on different devices, or for strength on different exercises (the
 * metric code, such as `e1rm_kg`, does not carry the exercise).
 */
export const TEST_COMPARISON_WARNINGS = [
  'mixed_methods',
  'mixed_protocol_versions',
  'mixed_devices',
  'mixed_exercises',
] as const;
export type TestComparisonWarning = (typeof TEST_COMPARISON_WARNINGS)[number];

/** How one of the compared results was measured. */
export interface ComparedMeasurement {
  readonly method: MeasurementMethod;
  readonly protocolVersion: number;
  readonly deviceId: string | null;
  /** Strength exercise (`trap_bar_deadlift`, `bench_press`); `null` for other tests. */
  readonly exercise?: string | null;
}

/**
 * Warnings for a set of results shown together (a series, a comparison).
 * Never silent: the UI shows them next to the data.
 */
export function testComparisonWarnings(
  measurements: readonly ComparedMeasurement[],
  options: { readonly sameDeviceOnly?: boolean } = {},
): TestComparisonWarning[] {
  const warnings: TestComparisonWarning[] = [];
  if (new Set(measurements.map((m) => m.method)).size > 1) warnings.push('mixed_methods');
  if (new Set(measurements.map((m) => m.protocolVersion)).size > 1) {
    warnings.push('mixed_protocol_versions');
  }
  if (options.sameDeviceOnly === true && new Set(measurements.map((m) => m.deviceId)).size > 1) {
    warnings.push('mixed_devices');
  }
  if (new Set(measurements.map((m) => m.exercise ?? null)).size > 1) {
    warnings.push('mixed_exercises');
  }
  return warnings;
}
