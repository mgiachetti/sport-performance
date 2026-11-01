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
   * category stage, in either direction. `0` disables maturation; `1` keeps
   * an early-maturing M13/M14 out of `performance` (no maximal loaded tests).
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
 * Default parameters for boys. Thresholds sit where the average maturer
 * (age at PHV ≈ 13.8 years, Mirwald 2002) crosses from M14 to M15 (offset
 * ≈ +0.5) and from M16 to M17 (offset ≈ +2.5), so a player of average
 * maturation keeps the stage of their category and only early or late
 * maturers (by about a year or more, with the margin) move.
 */
export const DEFAULT_MALE_STAGE_ASSIGNMENT_PARAMS = {
  developmentFromPhvOffsetYears: 0.5,
  performanceFromPhvOffsetYears: 2.5,
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
  developmentFromPhvOffsetYears: 2.5,
  performanceFromPhvOffsetYears: 4.5,
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
 * Values outside are rejected as input errors, not clamped.
 */
export const PHV_OFFSET_YEARS_RANGE = { min: -6, max: 8 } as const;

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
