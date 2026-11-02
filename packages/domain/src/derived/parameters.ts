import { DomainValidationError, describeValue } from '../errors.js';
import {
  DEFAULT_LOAD_PARAMETERS,
  resolveLoadParameters,
  type LoadParameters,
} from '../load/index.js';
import {
  DEFAULT_GROWTH_VELOCITY_PARAMS,
  DEFAULT_KHAMIS_ROCHE_PARAMS,
  DEFAULT_MATURITY_OFFSET_EQUATION,
  KHAMIS_ROCHE_1994_TABLE,
  isKhamisRocheAgeMode,
  isMaturityOffsetEquation,
  type GrowthVelocityParams,
  type KhamisRocheAgeMode,
  type MaturityOffsetEquation,
} from '../maturation/index.js';
import { assertIntegerInRange } from '../load/validate.js';

/**
 * Parameters of the values the worker derives for the panel (B-326): load
 * series, wellness against the player's own baseline and maturation. Stored
 * per club in `club.settings.derived` (partial JSON); every missing key takes
 * the default below, unknown keys are rejected so a typo never silently falls
 * back to a default.
 */

/** Rolling baseline of a player's own wellness (CLAUDE.md: "contra la media móvil propia"). */
export interface WellnessBaselineParams {
  /** Days before the evaluated day that form the baseline (the day itself is excluded). */
  readonly windowDays: number;
  /** Fewest entries in the window for a z-score. */
  readonly minSamples: number;
}

/**
 * Same defaults as the seeded `wellness_zscore_low` rule (B-207): 28 days, 10
 * entries, so the panel and the alert agree.
 */
export const DEFAULT_WELLNESS_BASELINE_PARAMS: WellnessBaselineParams = Object.freeze({
  windowDays: 28,
  minSamples: 10,
});

export interface MaturationParams {
  /** Preferred maturity-offset equation; see `maturityOffsetEquationChain`. */
  readonly maturityOffsetEquation: MaturityOffsetEquation;
  readonly growthVelocity: GrowthVelocityParams;
  /** `code` of the club's seeded Khamis-Roche table (`khamis_roche_table.code`). */
  readonly khamisRocheTableCode: string;
  readonly khamisRocheAgeMode: KhamisRocheAgeMode;
}

export const DEFAULT_MATURATION_PARAMS: MaturationParams = Object.freeze({
  maturityOffsetEquation: DEFAULT_MATURITY_OFFSET_EQUATION,
  growthVelocity: Object.freeze({ ...DEFAULT_GROWTH_VELOCITY_PARAMS }),
  khamisRocheTableCode: KHAMIS_ROCHE_1994_TABLE.code,
  khamisRocheAgeMode: DEFAULT_KHAMIS_ROCHE_PARAMS.ageMode,
});

export interface DerivedParameters {
  readonly load: LoadParameters;
  readonly wellnessBaseline: WellnessBaselineParams;
  readonly maturation: MaturationParams;
}

export const DEFAULT_DERIVED_PARAMETERS: DerivedParameters = Object.freeze({
  load: DEFAULT_LOAD_PARAMETERS,
  wellnessBaseline: DEFAULT_WELLNESS_BASELINE_PARAMS,
  maturation: DEFAULT_MATURATION_PARAMS,
});

/** Longest wellness baseline window (one year). */
export const MAX_WELLNESS_BASELINE_DAYS = 365;

function invalid(message: string, value: unknown): never {
  throw new DomainValidationError('invalid_argument', message, value);
}

function assertObject(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid(`${name} must be an object, got ${describeValue(value)}.`, value);
  }
}

function assertKnownKeys(value: Record<string, unknown>, keys: readonly string[], name: string) {
  const unknown = Object.keys(value).filter((key) => !keys.includes(key));
  if (unknown.length > 0) invalid(`Unknown ${name} parameters: ${unknown.join(', ')}.`, value);
}

function resolveWellnessBaseline(value: unknown): WellnessBaselineParams {
  if (value === undefined) return DEFAULT_WELLNESS_BASELINE_PARAMS;
  assertObject(value, 'wellnessBaseline');
  assertKnownKeys(value, ['windowDays', 'minSamples'], 'wellnessBaseline');
  const windowDays = value.windowDays ?? DEFAULT_WELLNESS_BASELINE_PARAMS.windowDays;
  const minSamples = value.minSamples ?? DEFAULT_WELLNESS_BASELINE_PARAMS.minSamples;
  assertIntegerInRange(windowDays, 'wellnessBaseline.windowDays', 2, MAX_WELLNESS_BASELINE_DAYS);
  // A sample standard deviation needs two entries.
  assertIntegerInRange(minSamples, 'wellnessBaseline.minSamples', 2, windowDays);
  return Object.freeze({ windowDays, minSamples });
}

function resolveMaturation(value: unknown): MaturationParams {
  if (value === undefined) return DEFAULT_MATURATION_PARAMS;
  assertObject(value, 'maturation');
  assertKnownKeys(
    value,
    ['maturityOffsetEquation', 'growthVelocity', 'khamisRocheTableCode', 'khamisRocheAgeMode'],
    'maturation',
  );
  const equation = value.maturityOffsetEquation ?? DEFAULT_MATURATION_PARAMS.maturityOffsetEquation;
  if (!isMaturityOffsetEquation(equation)) {
    invalid(`Unknown maturity offset equation ${describeValue(equation)}.`, equation);
  }
  const ageMode = value.khamisRocheAgeMode ?? DEFAULT_MATURATION_PARAMS.khamisRocheAgeMode;
  if (!isKhamisRocheAgeMode(ageMode)) {
    invalid(`Unknown Khamis-Roche age mode ${describeValue(ageMode)}.`, ageMode);
  }
  const tableCode = value.khamisRocheTableCode ?? DEFAULT_MATURATION_PARAMS.khamisRocheTableCode;
  if (typeof tableCode !== 'string' || !/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(tableCode)) {
    invalid(`Invalid Khamis-Roche table code ${describeValue(tableCode)}.`, tableCode);
  }
  let growthVelocity = DEFAULT_MATURATION_PARAMS.growthVelocity;
  if (value.growthVelocity !== undefined) {
    const gv = value.growthVelocity;
    assertObject(gv, 'maturation.growthVelocity');
    assertKnownKeys(gv, ['minIntervalDays', 'maxIntervalDays'], 'maturation.growthVelocity');
    const minIntervalDays = gv.minIntervalDays ?? DEFAULT_GROWTH_VELOCITY_PARAMS.minIntervalDays;
    const maxIntervalDays = gv.maxIntervalDays ?? DEFAULT_GROWTH_VELOCITY_PARAMS.maxIntervalDays;
    assertIntegerInRange(minIntervalDays, 'growthVelocity.minIntervalDays', 1, 3650);
    assertIntegerInRange(maxIntervalDays, 'growthVelocity.maxIntervalDays', minIntervalDays, 3650);
    growthVelocity = Object.freeze({ minIntervalDays, maxIntervalDays });
  }
  return Object.freeze({
    maturityOffsetEquation: equation,
    growthVelocity,
    khamisRocheTableCode: tableCode,
    khamisRocheAgeMode: ageMode,
  });
}

/**
 * Validates `club.settings.derived` (any JSON, possibly absent) and fills it
 * with the defaults. Throws {@link DomainValidationError} (`invalid_argument`).
 */
export function resolveDerivedParameters(settings: unknown = {}): DerivedParameters {
  if (settings === undefined || settings === null) return DEFAULT_DERIVED_PARAMETERS;
  assertObject(settings, 'derived settings');
  assertKnownKeys(settings, ['load', 'wellnessBaseline', 'maturation'], 'derived');
  return Object.freeze({
    load:
      settings.load === undefined ? DEFAULT_LOAD_PARAMETERS : resolveLoadParameters(settings.load),
    wellnessBaseline: resolveWellnessBaseline(settings.wellnessBaseline),
    maturation: resolveMaturation(settings.maturation),
  });
}
