import { DomainValidationError } from '../errors.js';
import { assertFinite } from './validation.js';

/**
 * Peak height velocity zone ("circa-PHV"): the months around the growth spurt
 * when the staff lowers jump and sprint volume and watches knees and heels
 * (Osgood-Schlatter, Sever). This module only decides whether a player is in
 * the zone; the alert text and severity are a rule of B-207.
 */

export interface PeakZoneParams {
  /**
   * Inclusive window of maturity offset (years from PHV), or `null` to ignore
   * the offset.
   */
  readonly offsetWindowYears: { readonly minYears: number; readonly maxYears: number } | null;
  /**
   * Growth velocity at or above which the player is in the zone regardless of
   * the offset, or `null` to ignore velocity.
   */
  readonly minGrowthVelocityCmYear: number | null;
}

/**
 * Defaults (club setting, B-322): offset between −1 and +1 year, the circa-PHV
 * band used in bio-banding. No velocity threshold by default: it has no single
 * published value and is left for the staff to set.
 */
export const DEFAULT_PEAK_ZONE_PARAMS: PeakZoneParams = {
  offsetWindowYears: { minYears: -1, maxYears: 1 },
  minGrowthVelocityCmYear: null,
};

/**
 * - `met` / `not_met`: the criterion is configured and the value is known.
 * - `unknown`: configured but the value is missing (no measurement).
 * - `disabled`: the criterion is turned off in the parameters.
 */
export type PeakZoneCriterionStatus = 'met' | 'not_met' | 'unknown' | 'disabled';

export interface PeakZoneInput {
  readonly maturityOffsetYears?: number | null | undefined;
  readonly growthVelocityCmYear?: number | null | undefined;
}

export interface PeakZoneResult {
  /** At least one criterion is met. */
  readonly inZone: boolean;
  /** At least one configured criterion had a value (otherwise `inZone` is meaningless). */
  readonly evaluable: boolean;
  readonly offset: PeakZoneCriterionStatus;
  readonly growthVelocity: PeakZoneCriterionStatus;
}

/** Whether a player is in the peak height velocity zone. */
export function peakHeightVelocityZone(
  input: PeakZoneInput,
  params: Partial<PeakZoneParams> = {},
): PeakZoneResult {
  const { offsetWindowYears, minGrowthVelocityCmYear } = { ...DEFAULT_PEAK_ZONE_PARAMS, ...params };
  if (offsetWindowYears !== null) {
    assertFinite(offsetWindowYears.minYears, 'offsetWindowYears.minYears');
    assertFinite(offsetWindowYears.maxYears, 'offsetWindowYears.maxYears');
    if (offsetWindowYears.minYears > offsetWindowYears.maxYears) {
      throw new DomainValidationError(
        'invalid_argument',
        'offsetWindowYears.minYears must not exceed maxYears.',
        offsetWindowYears,
      );
    }
  }
  if (minGrowthVelocityCmYear !== null) {
    assertFinite(minGrowthVelocityCmYear, 'minGrowthVelocityCmYear');
  }

  const maturityOffsetYears = input.maturityOffsetYears ?? null;
  const growthVelocityCmYear = input.growthVelocityCmYear ?? null;
  if (maturityOffsetYears !== null) assertFinite(maturityOffsetYears, 'maturityOffsetYears');
  if (growthVelocityCmYear !== null) assertFinite(growthVelocityCmYear, 'growthVelocityCmYear');

  const offset: PeakZoneCriterionStatus =
    offsetWindowYears === null
      ? 'disabled'
      : maturityOffsetYears === null
        ? 'unknown'
        : maturityOffsetYears >= offsetWindowYears.minYears &&
            maturityOffsetYears <= offsetWindowYears.maxYears
          ? 'met'
          : 'not_met';
  const growthVelocity: PeakZoneCriterionStatus =
    minGrowthVelocityCmYear === null
      ? 'disabled'
      : growthVelocityCmYear === null
        ? 'unknown'
        : growthVelocityCmYear >= minGrowthVelocityCmYear
          ? 'met'
          : 'not_met';

  const statuses = [offset, growthVelocity];
  return {
    inZone: statuses.includes('met'),
    evaluable: statuses.some((s) => s === 'met' || s === 'not_met'),
    offset,
    growthVelocity,
  };
}
