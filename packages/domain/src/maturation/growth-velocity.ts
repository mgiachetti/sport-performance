import { DomainValidationError } from '../errors.js';
import { compareLocalDates, daysBetween, type LocalDate } from '../time.js';
import { assertPositiveFinite } from './validation.js';

/**
 * Height growth velocity (metric `growth_velocity_cm_year`): change in
 * standing height divided by the time between two measurements, with years of
 * 365.25 days (the same year as decimal age).
 */

export interface HeightMeasurement {
  /** Club-local day of the measurement. */
  readonly date: LocalDate;
  readonly heightCm: number;
}

export interface GrowthVelocityParams {
  /**
   * Shortest interval accepted between the two measurements. Short intervals
   * amplify stadiometer error (±0.5 cm over 4 weeks is ±6.5 cm/year).
   */
  readonly minIntervalDays: number;
  /** Longest interval accepted: older pairs average out the current growth rate. */
  readonly maxIntervalDays: number;
}

/**
 * Defaults (club setting, B-322): at least 12 weeks, matching the quarterly
 * anthropometry of the battery, and at most 400 days so a missed quarter or a
 * yearly measurement still yields a value.
 */
export const DEFAULT_GROWTH_VELOCITY_PARAMS: GrowthVelocityParams = {
  minIntervalDays: 84,
  maxIntervalDays: 400,
};

export interface GrowthVelocityResult {
  readonly growthVelocityCmYear: number;
  readonly from: HeightMeasurement;
  readonly to: HeightMeasurement;
  readonly intervalDays: number;
}

const DAYS_PER_YEAR = 365.25;

/** Velocity between two measurements (cm/year). `to` must be after `from`. */
export function growthVelocityCmYear(from: HeightMeasurement, to: HeightMeasurement): number {
  assertPositiveFinite(from.heightCm, 'from.heightCm');
  assertPositiveFinite(to.heightCm, 'to.heightCm');
  const intervalDays = daysBetween(from.date, to.date);
  if (intervalDays <= 0) {
    throw new DomainValidationError(
      'invalid_argument',
      `Measurement ${to.date} must be after ${from.date}.`,
      { from: from.date, to: to.date },
    );
  }
  return (to.heightCm - from.heightCm) / (intervalDays / DAYS_PER_YEAR);
}

/**
 * Current growth velocity: from the latest measurement back to the most recent
 * earlier measurement whose interval is within the configured bounds. `null` if
 * there is no such pair. Input order does not matter; two measurements on the
 * same day are rejected (the caller stores one value per day).
 */
export function latestGrowthVelocity(
  measurements: readonly HeightMeasurement[],
  params: Partial<GrowthVelocityParams> = {},
): GrowthVelocityResult | null {
  const { minIntervalDays, maxIntervalDays } = { ...DEFAULT_GROWTH_VELOCITY_PARAMS, ...params };
  assertValidParams(minIntervalDays, maxIntervalDays);

  const sorted = [...measurements].sort((a, b) => compareLocalDates(a.date, b.date));
  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    if (current !== undefined && current.date === sorted[i - 1]?.date) {
      throw new DomainValidationError(
        'invalid_argument',
        `Two height measurements on ${current.date}; keep one per day.`,
        current.date,
      );
    }
  }

  const to = sorted[sorted.length - 1];
  if (to === undefined) return null;
  for (let i = sorted.length - 2; i >= 0; i--) {
    const from = sorted[i];
    if (from === undefined) continue;
    const intervalDays = daysBetween(from.date, to.date);
    if (intervalDays < minIntervalDays) continue;
    if (intervalDays > maxIntervalDays) return null;
    return { growthVelocityCmYear: growthVelocityCmYear(from, to), from, to, intervalDays };
  }
  return null;
}

function assertValidParams(minIntervalDays: number, maxIntervalDays: number): void {
  if (
    !Number.isInteger(minIntervalDays) ||
    !Number.isInteger(maxIntervalDays) ||
    minIntervalDays < 1 ||
    maxIntervalDays < minIntervalDays
  ) {
    throw new DomainValidationError(
      'invalid_argument',
      `Invalid growth velocity interval: min ${String(minIntervalDays)}, max ${String(maxIntervalDays)} days.`,
      { minIntervalDays, maxIntervalDays },
    );
  }
}
