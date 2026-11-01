import { DomainValidationError } from '../errors.js';
import { STAGES, compareStages, parseStage, type Stage } from '../stage.js';
import { compareLocalDates, daysBetween, parseLocalDate, type LocalDate } from '../time.js';
import {
  assertPhvOffsetYears,
  parseStageAssignmentParams,
  type StageAssignmentParams,
} from './params.js';

/** Days per year used to project an offset forward (the decimal-age convention). */
const DAYS_PER_YEAR = 365.25;

/** A maturity offset estimate (years from PHV) and the day it was measured. */
export interface PhvOffsetEstimate {
  /** Years from peak height velocity: negative before PHV, positive after. */
  readonly phvOffsetYears: number;
  /** Day of the anthropometry the estimate comes from. */
  readonly measuredOn: LocalDate;
}

/**
 * A stage pinned by staff. It applies from `fromDate` to `untilDate`, both
 * inclusive; without `untilDate` it applies until replaced.
 */
export interface StagePin {
  readonly stage: Stage;
  readonly fromDate: LocalDate;
  readonly untilDate?: LocalDate | undefined;
}

/** Where the assigned stage comes from. */
export const STAGE_BASES = ['manual', 'maturation', 'category'] as const;
export type StageBasis = (typeof STAGE_BASES)[number];

/**
 * Why the automatic assignment chose its stage. Stable codes for the UI
 * (texts live in `packages/i18n`) and for the stage history.
 */
export const AUTOMATIC_STAGE_REASONS = [
  /** No offset estimate: the category stage applies. */
  'no_maturation_estimate',
  /** The latest estimate is older than `maxPhvOffsetEstimateAgeDays`. */
  'maturation_estimate_stale',
  /** The estimate was measured after the day being assigned. */
  'maturation_estimate_after_date',
  /** Maturation suggests the same stage as the category. */
  'maturation_matches_category',
  /** Maturation differs, but the offset is within the uncertainty margin of the threshold. */
  'within_uncertainty_margin',
  /** Maturation moved the stage away from the category. */
  'maturation_shift',
  /** Maturation moved the stage, limited by `maxStageStepsFromCategory`. */
  'maturation_shift_capped',
] as const;
export type AutomaticStageReason = (typeof AUTOMATIC_STAGE_REASONS)[number];

/** The stage suggested from category and maturation, ignoring pins. */
export interface AutomaticStageAssignment {
  readonly stage: Stage;
  /** `maturation` only when maturation changed the category stage. */
  readonly basis: Exclude<StageBasis, 'manual'>;
  readonly reason: AutomaticStageReason;
  /** Stage of the player's category (`AgeBand.defaultStage`). */
  readonly categoryStage: Stage;
  /** Stage the offset alone points to (no margin, no cap), when usable. */
  readonly maturationStage?: Stage;
  /** Offset projected to the assignment day, when the estimate is usable. */
  readonly phvOffsetYearsOnDate?: number;
}

/** The stage of a player on a day. */
export interface StageAssignment {
  readonly stage: Stage;
  readonly basis: StageBasis;
  /** The pin in force, when `basis` is `manual`. */
  readonly pin?: StagePin;
  /** Always present so the UI can show "pinned to X, suggested Y". */
  readonly automatic: AutomaticStageAssignment;
}

export interface AssignPlayerStageInput {
  /** Day the stage is assigned for (club day). */
  readonly onDate: LocalDate;
  /** Stage of the player's category on that day (`AgeBand.defaultStage`). */
  readonly categoryStage: Stage;
  /** Latest maturity offset estimate, if any. */
  readonly phvOffset?: PhvOffsetEstimate | undefined;
  /** Stage pins set by staff (the whole history may be passed). */
  readonly pins?: readonly StagePin[] | undefined;
  /**
   * Club parameters for the player's sex, for example
   * `DEFAULT_STAGE_ASSIGNMENT_PARAMS_BY_SEX[player.sex]`.
   */
  readonly params: StageAssignmentParams;
}

/**
 * Stage the maturity offset alone points to: `foundation` below
 * `developmentFromPhvOffsetYears`, `performance` from
 * `performanceFromPhvOffsetYears`, `development` in between.
 */
export function maturationStageForPhvOffset(
  phvOffsetYears: number,
  params: Pick<
    StageAssignmentParams,
    'developmentFromPhvOffsetYears' | 'performanceFromPhvOffsetYears'
  >,
): Stage {
  if (phvOffsetYears >= params.performanceFromPhvOffsetYears) return 'performance';
  if (phvOffsetYears >= params.developmentFromPhvOffsetYears) return 'development';
  return 'foundation';
}

/**
 * Offset of an estimate projected to another day. The offset is
 * `age − age at PHV`, so it grows exactly one year per year elapsed.
 */
export function projectPhvOffsetYears(estimate: PhvOffsetEstimate, onDate: LocalDate): number {
  return estimate.phvOffsetYears + daysBetween(estimate.measuredOn, onDate) / DAYS_PER_YEAR;
}

/**
 * Pin in force on a day, or `undefined`. When several overlap, the one that
 * started last wins (on the same start day, the later one in the list).
 */
export function activeStagePin(pins: readonly StagePin[], onDate: LocalDate): StagePin | undefined {
  let active: StagePin | undefined;
  for (const pin of pins) {
    assertStagePin(pin);
    const started = compareLocalDates(pin.fromDate, onDate) <= 0;
    const ended = pin.untilDate !== undefined && compareLocalDates(pin.untilDate, onDate) < 0;
    if (!started || ended) continue;
    if (active === undefined || compareLocalDates(pin.fromDate, active.fromDate) >= 0) {
      active = pin;
    }
  }
  return active;
}

/** Stage suggested from category and maturation (B-204), ignoring pins. */
export function automaticPlayerStage(
  input: Omit<AssignPlayerStageInput, 'pins'>,
): AutomaticStageAssignment {
  const params = parseStageAssignmentParams(input.params);
  const categoryStage = parseStage(input.categoryStage);
  const onDate = parseLocalDate(input.onDate);
  const fromCategory = (reason: AutomaticStageReason): AutomaticStageAssignment => ({
    stage: categoryStage,
    basis: 'category',
    reason,
    categoryStage,
  });

  const estimate = input.phvOffset;
  if (estimate === undefined) return fromCategory('no_maturation_estimate');
  assertPhvOffsetYears(estimate.phvOffsetYears);
  const elapsedDays = daysBetween(parseLocalDate(estimate.measuredOn), onDate);
  if (elapsedDays < 0) return fromCategory('maturation_estimate_after_date');
  if (elapsedDays > params.maxPhvOffsetEstimateAgeDays) {
    return fromCategory('maturation_estimate_stale');
  }

  const phvOffsetYearsOnDate = projectPhvOffsetYears(estimate, onDate);
  const maturationStage = maturationStageForPhvOffset(phvOffsetYearsOnDate, params);
  const result = (stage: Stage, reason: AutomaticStageReason): AutomaticStageAssignment => ({
    stage,
    basis: stage === categoryStage ? 'category' : 'maturation',
    reason,
    categoryStage,
    maturationStage,
    phvOffsetYearsOnDate,
  });

  const direction = Math.sign(compareStages(maturationStage, categoryStage));
  if (direction === 0) return result(categoryStage, 'maturation_matches_category');

  // Moving up needs offset ≥ threshold + margin; moving down needs offset <
  // threshold − margin. Shifting the offset towards the category by the
  // margin and re-classifying expresses both.
  const marginStage = maturationStageForPhvOffset(
    phvOffsetYearsOnDate - direction * params.uncertaintyMarginYears,
    params,
  );
  const marginSteps = compareStages(marginStage, categoryStage);
  if (Math.sign(marginSteps) !== direction) {
    return result(categoryStage, 'within_uncertainty_margin');
  }

  const cappedSteps = direction * Math.min(Math.abs(marginSteps), params.maxStageStepsFromCategory);
  const stage = stageAtOffset(categoryStage, cappedSteps);
  return result(
    stage,
    cappedSteps === marginSteps ? 'maturation_shift' : 'maturation_shift_capped',
  );
}

/**
 * Stage of a player on a day (B-204): the stage pinned by staff if a pin is
 * in force, otherwise the category stage adjusted by maturation (years from
 * PHV). The stage never relaxes privacy: percentiles and named rankings are
 * also gated by the age band (`AgeBand`, B-303).
 */
export function assignPlayerStage(input: AssignPlayerStageInput): StageAssignment {
  const automatic = automaticPlayerStage(input);
  const pin = activeStagePin(input.pins ?? [], input.onDate);
  if (pin === undefined) return { stage: automatic.stage, basis: automatic.basis, automatic };
  return { stage: pin.stage, basis: 'manual', pin, automatic };
}

function stageAtOffset(stage: Stage, steps: number): Stage {
  const index = STAGES.indexOf(stage) + steps;
  const target = STAGES[Math.max(0, Math.min(STAGES.length - 1, index))];
  // Unreachable: the index is clamped to the array bounds.
  if (target === undefined) throw new Error('Stage index out of range.');
  return target;
}

function assertStagePin(pin: StagePin): void {
  parseStage(pin.stage);
  parseLocalDate(pin.fromDate);
  if (pin.untilDate === undefined) return;
  parseLocalDate(pin.untilDate);
  if (compareLocalDates(pin.untilDate, pin.fromDate) < 0) {
    throw new DomainValidationError(
      'invalid_argument',
      `Stage pin untilDate (${pin.untilDate}) is before fromDate (${pin.fromDate}).`,
      pin,
    );
  }
}
