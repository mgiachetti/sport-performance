import { DomainValidationError, describeValue } from '../errors.js';
import type { Sex } from '../sex.js';
import { STAGES } from '../stage.js';

/**
 * Parameters of the automatic stage assignment (B-204). Configurable per club
 * and sex; the defaults below are data, ready to be seeded into the database.
 */
export interface StageAssignmentParams {
  /**
   * Years from PHV (maturity offset) from which maturation alone suggests the
   * `development` stage. Below it maturation suggests `foundation`.
   */
  readonly developmentFromPhvOffsetYears: number;
  /** Years from PHV from which maturation alone suggests `performance`. */
  readonly performanceFromPhvOffsetYears: number;
  /**
   * Maturation only overrides the category stage when the offset is beyond
   * the relevant threshold by more than this margin. It absorbs the error of
   * the offset equations (SEE ≈ 0.5–0.6 years for Mirwald 2002 and Moore
   * 2015) so a player on the boundary keeps the stage of their category.
   */
  readonly uncertaintyMarginYears: number;
  /**
   * Maximum number of stages maturation may move a player away from the
   * category stage, in either direction. `0` disables maturation (reason
   * `maturation_disabled`); `1` keeps an early-maturing M13/M14 out of
   * `performance`. With `2` an M13/M14 can reach `performance`, but maximal
   * loaded tests stay forbidden by the age band
   * (`AgeBand.maximalLoadTestsForPlayers`, principle 3).
   */
  readonly maxStageStepsFromCategory: number;
  /**
   * An offset estimate older than this (in days) is ignored and the category
   * stage is used. Anthropometry runs every 4–13 weeks, so a year-old
   * estimate means the player stopped being measured.
   */
  readonly maxPhvOffsetEstimateAgeDays: number;
}

/**
 * Default parameters for boys. A band spans the age reached in the season
 * year, so an M14 is 13.0 to 15.0 years old on the club day and the average
 * maturer (age at PHV ≈ 13.8 years, Mirwald 2002) runs from offset −0.8 to
 * +1.2 within it. With the 0.5-year margin, the thresholds 0.7 and 2.7 put
 * the "move up" points at +1.2 and +3.2 and the "move down" points at +0.2
 * and +2.2: exactly the edges of the M13–M14 / M15–M16 / M17+ age ranges for
 * an average maturer. So an average maturer keeps the stage of their category
 * on every day of every band, and only early or late maturers move.
 */
export const DEFAULT_MALE_STAGE_ASSIGNMENT_PARAMS = {
  developmentFromPhvOffsetYears: 0.7,
  performanceFromPhvOffsetYears: 2.7,
  uncertaintyMarginYears: 0.5,
  maxStageStepsFromCategory: 1,
  maxPhvOffsetEstimateAgeDays: 365,
} as const satisfies StageAssignmentParams;

/**
 * Default parameters for girls: the male thresholds shifted by the ≈ 2-year
 * difference in mean age at PHV (≈ 11.8 years). Pending validation with the
 * staff and the female maturation work (B-805).
 */
export const DEFAULT_FEMALE_STAGE_ASSIGNMENT_PARAMS = {
  developmentFromPhvOffsetYears: 2.7,
  performanceFromPhvOffsetYears: 4.7,
  uncertaintyMarginYears: 0.5,
  maxStageStepsFromCategory: 1,
  maxPhvOffsetEstimateAgeDays: 365,
} as const satisfies StageAssignmentParams;

/** Default parameters per sex. There is no default sex (ADR 0017). */
export const DEFAULT_STAGE_ASSIGNMENT_PARAMS_BY_SEX: Readonly<Record<Sex, StageAssignmentParams>> =
  {
    male: DEFAULT_MALE_STAGE_ASSIGNMENT_PARAMS,
    female: DEFAULT_FEMALE_STAGE_ASSIGNMENT_PARAMS,
  };

/**
 * Plausible range of a maturity offset (years from PHV) for a youth player.
 * Values outside are rejected as input errors, not clamped. The upper bound
 * covers the oldest M19 girl (almost 20 years old) maturing a year or more
 * earlier than average (age at PHV ≈ 11.8): offset ≈ 8–9.
 */
export const PHV_OFFSET_YEARS_RANGE = { min: -6, max: 10 } as const;

/**
 * Validates a set of parameters and returns it unchanged. Throws
 * {@link DomainValidationError} (`invalid_argument`) on the first problem.
 * Use it when loading club configuration.
 */
export function parseStageAssignmentParams(value: StageAssignmentParams): StageAssignmentParams {
  const {
    developmentFromPhvOffsetYears,
    performanceFromPhvOffsetYears,
    uncertaintyMarginYears,
    maxStageStepsFromCategory,
    maxPhvOffsetEstimateAgeDays,
  } = value;
  assertFinite(developmentFromPhvOffsetYears, 'developmentFromPhvOffsetYears');
  assertFinite(performanceFromPhvOffsetYears, 'performanceFromPhvOffsetYears');
  if (performanceFromPhvOffsetYears <= developmentFromPhvOffsetYears) {
    throw invalid(
      `performanceFromPhvOffsetYears (${String(performanceFromPhvOffsetYears)}) must be greater than developmentFromPhvOffsetYears (${String(developmentFromPhvOffsetYears)}).`,
      value,
    );
  }
  assertFinite(uncertaintyMarginYears, 'uncertaintyMarginYears');
  if (uncertaintyMarginYears < 0) {
    throw invalid(
      `uncertaintyMarginYears must be ≥ 0, got ${String(uncertaintyMarginYears)}.`,
      value,
    );
  }
  const maxSteps = STAGES.length - 1;
  if (
    !Number.isInteger(maxStageStepsFromCategory) ||
    maxStageStepsFromCategory < 0 ||
    maxStageStepsFromCategory > maxSteps
  ) {
    throw invalid(
      `maxStageStepsFromCategory must be an integer from 0 to ${String(maxSteps)}, got ${describeValue(maxStageStepsFromCategory)}.`,
      value,
    );
  }
  if (!Number.isInteger(maxPhvOffsetEstimateAgeDays) || maxPhvOffsetEstimateAgeDays <= 0) {
    throw invalid(
      `maxPhvOffsetEstimateAgeDays must be a positive integer, got ${describeValue(maxPhvOffsetEstimateAgeDays)}.`,
      value,
    );
  }
  return value;
}

/** Throws unless `value` is a finite offset within {@link PHV_OFFSET_YEARS_RANGE}. */
export function assertPhvOffsetYears(value: number, name = 'phvOffsetYears'): void {
  assertFinite(value, name);
  if (value < PHV_OFFSET_YEARS_RANGE.min || value > PHV_OFFSET_YEARS_RANGE.max) {
    throw invalid(
      `${name} must be between ${String(PHV_OFFSET_YEARS_RANGE.min)} and ${String(PHV_OFFSET_YEARS_RANGE.max)} years, got ${String(value)}.`,
      value,
    );
  }
}

function assertFinite(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalid(`${name} must be a finite number, got ${describeValue(value)}.`, value);
  }
}

function invalid(message: string, value: unknown): DomainValidationError {
  return new DomainValidationError('invalid_argument', message, value);
}
