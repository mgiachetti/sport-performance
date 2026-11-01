import { memberGuard } from '../enum.js';
import { DomainValidationError, describeValue } from '../errors.js';
import { assertIntegerInRange } from './validate.js';

/**
 * Value of the EWMA on the first day of history.
 *
 * - `first_day`: the EWMA of the first day equals that day's load, so the
 *   series starts at the player's own level.
 * - `zero`: the EWMA before the first day is 0, so the first day is
 *   `load·λ`. Underestimates the chronic EWMA for weeks; use it only to match
 *   a club's existing spreadsheet.
 */
export const EWMA_SEEDS = ['first_day', 'zero'] as const;
export type EwmaSeed = (typeof EWMA_SEEDS)[number];
export const isEwmaSeed = memberGuard(EWMA_SEEDS);

/**
 * Standard deviation used by Foster's monotony.
 *
 * - `sample`: divides by `n − 1` (spreadsheet `STDEV` / `DESVEST`, what staff
 *   usually reproduce by hand).
 * - `population`: divides by `n` (`STDEV.P` / `DESVEST.P`).
 */
export const STANDARD_DEVIATION_KINDS = ['sample', 'population'] as const;
export type StandardDeviationKind = (typeof STANDARD_DEVIATION_KINDS)[number];
export const isStandardDeviationKind = memberGuard(STANDARD_DEVIATION_KINDS);

/** Per-club training load configuration (seeded and editable, B-322). */
export interface LoadParameters {
  /** EWMA window of the acute load, in days (`N`, `λ = 2/(N+1)`). */
  readonly acuteWindowDays: number;
  /** EWMA window of the chronic load, in days. Greater than the acute window. */
  readonly chronicWindowDays: number;
  /** Days of history below which the ACWR is `insufficient_history`. */
  readonly minHistoryDays: number;
  readonly ewmaSeed: EwmaSeed;
  /** Days in the rolling window of Foster's monotony and strain. */
  readonly monotonyWindowDays: number;
  readonly monotonyStandardDeviation: StandardDeviationKind;
}

/**
 * Defaults (CLAUDE.md, "Monitoreo y cálculos"): acute N = 7, chronic N = 28,
 * insufficient history below 28 days, weekly monotony. Plain data, ready to be
 * seeded as the club's default configuration.
 */
export const DEFAULT_LOAD_PARAMETERS: LoadParameters = Object.freeze({
  acuteWindowDays: 7,
  chronicWindowDays: 28,
  minHistoryDays: 28,
  ewmaSeed: 'first_day',
  monotonyWindowDays: 7,
  monotonyStandardDeviation: 'sample',
});

/** Longest window accepted by any parameter (one year). */
export const MAX_LOAD_WINDOW_DAYS = 365;

const PARAMETER_KEYS: ReadonlySet<string> = new Set(Object.keys(DEFAULT_LOAD_PARAMETERS));

/**
 * Validates a (partial) club configuration, typically JSON read from the
 * database, and fills the missing keys from {@link DEFAULT_LOAD_PARAMETERS}.
 * Unknown keys are rejected so that a typo never silently falls back to a
 * default. Throws {@link DomainValidationError} (`invalid_argument`).
 */
export function resolveLoadParameters(overrides: unknown = {}): LoadParameters {
  if (typeof overrides !== 'object' || overrides === null || Array.isArray(overrides)) {
    throw new DomainValidationError(
      'invalid_argument',
      `Load parameters must be an object, got ${describeValue(overrides)}.`,
      overrides,
    );
  }
  const unknownKeys = Object.keys(overrides).filter((key) => !PARAMETER_KEYS.has(key));
  if (unknownKeys.length > 0) {
    throw new DomainValidationError(
      'invalid_argument',
      `Unknown load parameters: ${unknownKeys.join(', ')}.`,
      overrides,
    );
  }
  const merged: Record<string, unknown> = { ...DEFAULT_LOAD_PARAMETERS };
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) merged[key] = value;
  }
  const {
    acuteWindowDays,
    chronicWindowDays,
    minHistoryDays,
    ewmaSeed,
    monotonyWindowDays,
    monotonyStandardDeviation,
  } = merged;

  assertIntegerInRange(acuteWindowDays, 'acuteWindowDays', 1, MAX_LOAD_WINDOW_DAYS);
  assertIntegerInRange(chronicWindowDays, 'chronicWindowDays', 2, MAX_LOAD_WINDOW_DAYS);
  if (acuteWindowDays >= chronicWindowDays) {
    throw new DomainValidationError(
      'invalid_argument',
      `acuteWindowDays (${String(acuteWindowDays)}) must be less than chronicWindowDays (${String(chronicWindowDays)}).`,
      overrides,
    );
  }
  assertIntegerInRange(minHistoryDays, 'minHistoryDays', 1, MAX_LOAD_WINDOW_DAYS);
  if (!isEwmaSeed(ewmaSeed)) {
    throw new DomainValidationError(
      'invalid_argument',
      `ewmaSeed must be one of ${EWMA_SEEDS.join(', ')}, got ${describeValue(ewmaSeed)}.`,
      ewmaSeed,
    );
  }
  assertIntegerInRange(monotonyWindowDays, 'monotonyWindowDays', 2, MAX_LOAD_WINDOW_DAYS);
  if (!isStandardDeviationKind(monotonyStandardDeviation)) {
    throw new DomainValidationError(
      'invalid_argument',
      `monotonyStandardDeviation must be one of ${STANDARD_DEVIATION_KINDS.join(', ')}, got ${describeValue(monotonyStandardDeviation)}.`,
      monotonyStandardDeviation,
    );
  }
  return Object.freeze({
    acuteWindowDays,
    chronicWindowDays,
    minHistoryDays,
    ewmaSeed,
    monotonyWindowDays,
    monotonyStandardDeviation,
  });
}
