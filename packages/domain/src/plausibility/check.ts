import type { MetricCode } from '../codes.js';
import { DomainValidationError, describeValue } from '../errors.js';
import { parseSex, type Sex } from '../sex.js';
import { DEFAULT_PLAUSIBLE_RANGES } from './defaults.js';
import { validatePlausibleRanges, type PlausibleRange } from './ranges.js';

export interface PlausibilityInput {
  readonly metricCode: MetricCode;
  /** Entered value, in the unit of the metric code (`sprint_40_s` → s). */
  readonly value: number;
  readonly sex: Sex;
  /**
   * Decimal age at the measurement date (`decimalAgeYears(birthDate,
   * measuredOn)`), or `null` when the birth date is unknown: then the
   * envelope of every age range of the metric for that sex is used.
   */
  readonly ageYears: number | null;
}

/** Bounds actually used for a check. */
export interface PlausibleBounds {
  /** Inclusive, in the unit of the metric code. */
  readonly minValue: number;
  /** Inclusive, in the unit of the metric code. */
  readonly maxValue: number;
  /**
   * `true` when a single range matched the player's age; `false` when the age
   * was unknown and the envelope of all age ranges was used.
   */
  readonly resolvedByAge: boolean;
}

export type PlausibilityResult =
  /** No range configured for the metric, sex and age: nothing to warn about. */
  | { readonly status: 'no_range' }
  | { readonly status: 'within'; readonly bounds: PlausibleBounds }
  | {
      readonly status: 'below' | 'above';
      readonly bounds: PlausibleBounds;
      /**
       * Values obtained by moving the decimal separator (× 10^k, |k| ≤ 3) that
       * fall within the bounds, closest shift first. Lets the UI ask "did you
       * mean 5,12?" when 512 was typed.
       */
      readonly suggestedValues: readonly number[];
    };

export type PlausibilityChecker = (input: PlausibilityInput) => PlausibilityResult;

/** Decimal shifts tried for suggestions, closest first. */
const DECIMAL_SHIFTS = [1, -1, 2, -2, 3, -3] as const;

/** Significant digits kept in suggestions, enough to drop floating-point noise. */
const SUGGESTION_PRECISION = 12;

/**
 * Validates and indexes the ranges once and returns a checker. An out-of-range
 * value is reported in the result, never thrown: the entry is not blocked.
 * The checker throws {@link DomainValidationError} only for invalid input
 * (non-finite value, negative or non-finite age, invalid sex).
 */
export function createPlausibilityChecker(
  ranges: readonly PlausibleRange[] = DEFAULT_PLAUSIBLE_RANGES,
): PlausibilityChecker {
  validatePlausibleRanges(ranges);

  const byMetric = new Map<string, PlausibleRange[]>();
  for (const range of ranges) {
    const list = byMetric.get(range.metricCode);
    if (list === undefined) byMetric.set(range.metricCode, [range]);
    else list.push(range);
  }

  return (input: PlausibilityInput): PlausibilityResult => {
    assertValidInput(input);
    const sex = parseSex(input.sex);
    const candidates = (byMetric.get(input.metricCode) ?? []).filter(
      (range) => range.sex === null || range.sex === sex,
    );

    const bounds =
      input.ageYears === null
        ? envelope(candidates)
        : boundsForAge(candidates, sex, input.ageYears);
    if (bounds === null) return { status: 'no_range' };

    const { value } = input;
    if (value >= bounds.minValue && value <= bounds.maxValue) return { status: 'within', bounds };
    return {
      status: value < bounds.minValue ? 'below' : 'above',
      bounds,
      suggestedValues: decimalShiftSuggestions(value, bounds),
    };
  };
}

/**
 * One-off check. Prefer {@link createPlausibilityChecker} when checking many
 * values against the same ranges, since it validates and indexes them once.
 */
export function checkPlausibleValue(
  input: PlausibilityInput,
  ranges: readonly PlausibleRange[] = DEFAULT_PLAUSIBLE_RANGES,
): PlausibilityResult {
  return ranges === DEFAULT_PLAUSIBLE_RANGES
    ? defaultChecker()(input)
    : createPlausibilityChecker(ranges)(input);
}

let cachedDefaultChecker: PlausibilityChecker | undefined;

function defaultChecker(): PlausibilityChecker {
  cachedDefaultChecker ??= createPlausibilityChecker(DEFAULT_PLAUSIBLE_RANGES);
  return cachedDefaultChecker;
}

function boundsForAge(
  candidates: readonly PlausibleRange[],
  sex: Sex,
  ageYears: number,
): PlausibleBounds | null {
  const matching = candidates.filter(
    (range) =>
      (range.minAgeYears === null || ageYears >= range.minAgeYears) &&
      (range.maxAgeYears === null || ageYears < range.maxAgeYears),
  );
  // Validation guarantees at most one match per sex level; sex-specific wins.
  const range =
    matching.find((candidate) => candidate.sex === sex) ??
    matching.find((candidate) => candidate.sex === null);
  return range === undefined
    ? null
    : { minValue: range.minValue, maxValue: range.maxValue, resolvedByAge: true };
}

function envelope(candidates: readonly PlausibleRange[]): PlausibleBounds | null {
  if (candidates.length === 0) return null;
  return {
    minValue: Math.min(...candidates.map((range) => range.minValue)),
    maxValue: Math.max(...candidates.map((range) => range.maxValue)),
    resolvedByAge: false,
  };
}

function decimalShiftSuggestions(value: number, bounds: PlausibleBounds): number[] {
  const suggestions: number[] = [];
  for (const shift of DECIMAL_SHIFTS) {
    const candidate = Number((value * 10 ** shift).toPrecision(SUGGESTION_PRECISION));
    if (
      candidate >= bounds.minValue &&
      candidate <= bounds.maxValue &&
      !suggestions.includes(candidate)
    ) {
      suggestions.push(candidate);
    }
  }
  return suggestions;
}

function assertValidInput(input: PlausibilityInput): void {
  if (!Number.isFinite(input.value)) {
    throw new DomainValidationError(
      'invalid_argument',
      `Plausibility check of ${input.metricCode}: value must be a finite number, got ${describeValue(input.value)}.`,
      input.value,
    );
  }
  const { ageYears } = input;
  if (ageYears !== null && (!Number.isFinite(ageYears) || ageYears < 0)) {
    throw new DomainValidationError(
      'invalid_argument',
      `Plausibility check of ${input.metricCode}: ageYears must be null or a finite non-negative number, got ${describeValue(ageYears)}.`,
      ageYears,
    );
  }
}
