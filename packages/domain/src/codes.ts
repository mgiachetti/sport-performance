import type { Brand } from './brand.js';
import { DomainValidationError, describeValue, type DomainErrorCode } from './errors.js';
import type { Sport } from './sport.js';
import type { UnitCode } from './units.js';

/**
 * Code of a metric in the metric dictionary (`hsr_abs_m`). The dictionary is
 * data (seeded in B-306, extended per club), so any well-formed code is valid;
 * the canonical ones are listed in {@link CANONICAL_METRICS}.
 */
export type MetricCode = Brand<string, 'MetricCode'>;

/** Code of a test definition (`cmj`, `sprint_40`). Also data, like metrics. */
export type TestCode = Brand<string, 'TestCode'>;

/** English `snake_case`, starts with a letter, at most 64 characters. */
const CODE_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const CODE_MAX_LENGTH = 64;

/** Never name a metric after Catapult's trademark; use `accel_load_au`. */
const FORBIDDEN_CODE_FRAGMENT = 'playerload';

export function isWellFormedCode(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= CODE_MAX_LENGTH &&
    CODE_PATTERN.test(value) &&
    !value.replaceAll('_', '').includes(FORBIDDEN_CODE_FRAGMENT)
  );
}

function assertWellFormedCode(
  value: unknown,
  code: DomainErrorCode,
  label: string,
): asserts value is string {
  if (isWellFormedCode(value)) return;
  throw new DomainValidationError(
    code,
    `Invalid ${label}: ${describeValue(value)}. Expected English snake_case (max ${String(CODE_MAX_LENGTH)} chars).`,
    value,
  );
}

export function isMetricCode(value: unknown): value is MetricCode {
  return isWellFormedCode(value);
}

export function parseMetricCode(value: unknown): MetricCode {
  assertWellFormedCode(value, 'invalid_metric_code', 'metric code');
  return value as MetricCode;
}

export function isTestCode(value: unknown): value is TestCode {
  return isWellFormedCode(value);
}

export function parseTestCode(value: unknown): TestCode {
  assertWellFormedCode(value, 'invalid_test_code', 'test code');
  return value as TestCode;
}

/** Canonical test battery (CLAUDE.md, "Batería de tests"). */
export const CANONICAL_TEST_CODES = [
  'anthro',
  'sprint_40',
  'cmj',
  'cod_505',
  'ift_3015',
  'bronco',
  'strength',
  'mobility',
  'reaction',
  'neck',
] as const;
export type CanonicalTestCode = (typeof CANONICAL_TEST_CODES)[number];

/** Canonical codes are well formed by construction (checked by tests). */
export function canonicalTestCode(code: CanonicalTestCode): TestCode {
  return code as TestCode;
}

/** What a metric is collected from. */
export type MetricSource =
  /** Field / GPS data, equivalent to Catapult's (OpenField exports, our pod). */
  | 'field'
  /** A physical test of the battery. */
  | 'test'
  /** Training load monitoring (RPE, sRPE). */
  | 'load';

/** Which direction is an improvement; drives "best attempt" and percentiles. */
export type MetricDirection = 'higher_is_better' | 'lower_is_better' | 'neutral';

export interface CanonicalMetric {
  readonly unit: UnitCode;
  readonly source: MetricSource;
  readonly direction: MetricDirection;
  /** Test that produces the metric, for `source: 'test'`. */
  readonly test?: CanonicalTestCode;
  /** Sports where the metric applies; omitted means every sport. */
  readonly sports?: readonly Sport[];
  /** Short English definition for developers; UI texts live in i18n. */
  readonly description: string;
}

/**
 * Canonical metric dictionary from CLAUDE.md. Every code ends with its unit
 * suffix, except the established heart-rate and TRIMP codes listed in
 * {@link UNITLESS_NAME_METRIC_CODES}.
 */
export const CANONICAL_METRICS = {
  // Field metrics (Catapult equivalence). Thresholds are configurable (B-209).
  dist_m: field('m', 'higher_is_better', 'Total distance.'),
  dist_m_min: field('m_min', 'higher_is_better', 'Distance per minute.'),
  hsr_abs_m: field(
    'm',
    'higher_is_better',
    'Distance above the absolute HSR threshold (default 5.5 m/s for men, 5.28 m/s for women).',
  ),
  hsr_rel_m: field('m', 'higher_is_better', "Distance above 60% of the player's Vmax."),
  vmax_ms: field('ms', 'higher_is_better', 'Peak speed in the session.'),
  vmax_pct: field('pct', 'neutral', "Session peak speed as % of the player's Vmax."),
  acc_n: field('n', 'neutral', 'Accelerations above the threshold (default 2 m/s²).'),
  dec_n: field('n', 'neutral', 'Decelerations above the threshold (default 2 m/s²).'),
  accel_load_au: field('au', 'neutral', 'Accelerometer load (never called "PlayerLoad").'),
  contacts_n: field('n', 'neutral', 'Contacts.', ['rugby']),
  scrums_n: field('n', 'neutral', 'Scrums.', ['rugby']),
  kicks_n: field('n', 'neutral', 'Kicks.', ['rugby']),
  time_to_feet_s: field('s', 'lower_is_better', 'Time back on feet after a contact.', ['rugby']),
  big_time_s: field('s', 'neutral', 'Time in high-intensity bouts.'),
  hr_avg: field('bpm', 'neutral', 'Average heart rate.'),
  hr_max: field('bpm', 'neutral', 'Maximum heart rate.'),
  trimp: field('au', 'neutral', 'Training impulse from heart rate.'),

  // anthro
  height_cm: test('anthro', 'cm', 'neutral', 'Standing height.'),
  sitting_height_cm: test('anthro', 'cm', 'neutral', 'Sitting height.'),
  weight_kg: test('anthro', 'kg', 'neutral', 'Body mass.'),
  skinfolds_sum_mm: test('anthro', 'mm', 'neutral', 'Sum of ISAK skinfolds (performance stage).'),
  phv_offset_years: test(
    'anthro',
    'years',
    'neutral',
    'Maturity offset: years from peak height velocity.',
  ),
  adult_height_pct: test(
    'anthro',
    'pct',
    'neutral',
    'Percentage of predicted adult height (Khamis-Roche).',
  ),
  growth_velocity_cm_year: test('anthro', 'cm_year', 'neutral', 'Height growth velocity.'),

  // sprint_40
  sprint_10_s: test('sprint_40', 's', 'lower_is_better', 'Split time at 10 m.'),
  sprint_20_s: test('sprint_40', 's', 'lower_is_better', 'Split time at 20 m.'),
  sprint_40_s: test('sprint_40', 's', 'lower_is_better', 'Time at 40 m.'),
  sprint_vmax_ms: test(
    'sprint_40',
    'ms',
    'higher_is_better',
    'Vmax over 20–40 m: 20 / (t40 − t20).',
  ),

  // cmj
  cmj_height_cm: test('cmj', 'cm', 'higher_is_better', 'Jump height from flight time, best of 3.'),

  // cod_505
  cod505_left_s: test('cod_505', 's', 'lower_is_better', '505 time turning on the left foot.'),
  cod505_right_s: test('cod_505', 's', 'lower_is_better', '505 time turning on the right foot.'),
  cod505_asymmetry_pct: test('cod_505', 'pct', 'lower_is_better', 'Left/right 505 asymmetry.'),

  // ift_3015
  vift_kmh: test('ift_3015', 'kmh', 'higher_is_better', '30-15 IFT final velocity.'),

  // bronco
  bronco_time_s: test('bronco', 's', 'lower_is_better', 'Bronco completion time.'),

  // strength (the exercise is an attribute of the result, not part of the code)
  pushups_n: test('strength', 'n', 'higher_is_better', 'Push-ups with good technique.'),
  pullups_n: test('strength', 'n', 'higher_is_better', 'Pull-ups with good technique.'),
  plank_s: test('strength', 's', 'higher_is_better', 'Plank hold time.'),
  technique_score: test('strength', 'score', 'higher_is_better', 'Technique score 1–3.'),
  e1rm_kg: test('strength', 'kg', 'higher_is_better', 'Estimated 1RM (Epley with RIR).'),
  rm1_kg: test('strength', 'kg', 'higher_is_better', 'Direct 1RM.'),
  rm3_kg: test('strength', 'kg', 'higher_is_better', 'Direct 3RM.'),
  relative_strength_kg_kg: test(
    'strength',
    'kg_kg',
    'higher_is_better',
    'Load relative to body mass.',
  ),

  // mobility
  knee_to_wall_left_cm: test('mobility', 'cm', 'higher_is_better', 'Knee-to-wall, left.'),
  knee_to_wall_right_cm: test('mobility', 'cm', 'higher_is_better', 'Knee-to-wall, right.'),

  // reaction (compare only against the same player on the same device)
  reaction_simple_msec: test('reaction', 'msec', 'lower_is_better', 'Simple reaction time.'),
  reaction_go_no_go_msec: test('reaction', 'msec', 'lower_is_better', 'Go/no-go reaction time.'),

  // neck (Phase 2 hardware)
  neck_flexion_newton: test('neck', 'newton', 'higher_is_better', 'Isometric neck flexion.'),
  neck_extension_newton: test('neck', 'newton', 'higher_is_better', 'Isometric neck extension.'),
  neck_left_newton: test(
    'neck',
    'newton',
    'higher_is_better',
    'Isometric neck lateral flexion, left.',
  ),
  neck_right_newton: test(
    'neck',
    'newton',
    'higher_is_better',
    'Isometric neck lateral flexion, right.',
  ),

  // load monitoring
  rpe_score: load('score', 'CR-10 session RPE.'),
  srpe_au: load('au', 'Session RPE load: RPE × minutes.'),
  session_duration_min: load('min', 'Session duration.'),
} as const satisfies Readonly<Record<string, CanonicalMetric>>;

export type CanonicalMetricCode = keyof typeof CANONICAL_METRICS;

export const CANONICAL_METRIC_CODES = Object.keys(CANONICAL_METRICS) as CanonicalMetricCode[];

/** Canonical field metrics (Catapult equivalence), in dictionary order: the columns of a session view. */
export const FIELD_METRIC_CODES = CANONICAL_METRIC_CODES.filter((code) => {
  const metric: CanonicalMetric = CANONICAL_METRICS[code];
  return metric.source === 'field';
});

/** Established codes that keep their name without a unit suffix. */
export const UNITLESS_NAME_METRIC_CODES = [
  'hr_avg',
  'hr_max',
  'trimp',
] as const satisfies readonly CanonicalMetricCode[];

export function isCanonicalMetricCode(value: unknown): value is CanonicalMetricCode {
  return typeof value === 'string' && Object.hasOwn(CANONICAL_METRICS, value);
}

export function canonicalMetricCode(code: CanonicalMetricCode): MetricCode {
  return code as MetricCode;
}

/** Canonical metrics produced by a test, in dictionary order. */
export function canonicalMetricsOfTest(test: CanonicalTestCode): CanonicalMetricCode[] {
  return CANONICAL_METRIC_CODES.filter((code) => {
    const metric: CanonicalMetric = CANONICAL_METRICS[code];
    return metric.test === test;
  });
}

function field<const U extends UnitCode, const S extends readonly Sport[]>(
  unit: U,
  direction: MetricDirection,
  description: string,
  sports?: S,
) {
  return sports === undefined
    ? ({ unit, source: 'field', direction, description } as const)
    : ({ unit, source: 'field', direction, description, sports } as const);
}

function test<const T extends CanonicalTestCode, const U extends UnitCode>(
  testCode: T,
  unit: U,
  direction: MetricDirection,
  description: string,
) {
  return { unit, source: 'test', direction, test: testCode, description } as const;
}

function load<const U extends UnitCode>(unit: U, description: string) {
  return { unit, source: 'load', direction: 'neutral', description } as const;
}
