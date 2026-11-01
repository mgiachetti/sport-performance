import type { MetricDirection } from '../codes.js';
import { DomainValidationError, describeValue } from '../errors.js';

/**
 * Percentile rank of `value` in `values` (the comparison group), from 0 to
 * 100, using the mid-rank definition:
 *
 * `PR = (worse + 0.5 · equal) / N × 100`
 *
 * "Worse" follows the metric direction: lower values for `higher_is_better`,
 * higher values for `lower_is_better` (a faster sprint ranks higher). Neutral
 * metrics rank ascending, like `higher_is_better`. `value` does not need to be
 * one of `values` (for example, a first-team reference placed in a youth
 * group). `values` need not be sorted.
 */
export function percentileRank(
  value: number,
  values: readonly number[],
  direction: MetricDirection,
): number {
  assertFinite(value, 'value');
  assertNonEmpty(values, 'percentileRank');
  let worse = 0;
  let equal = 0;
  for (const v of values) {
    assertFinite(v, 'values[]');
    if (v === value) equal += 1;
    else if (direction === 'lower_is_better' ? v > value : v < value) worse += 1;
  }
  return ((worse + 0.5 * equal) / values.length) * 100;
}

/**
 * Value at a percentile of the group (0–100), by linear interpolation between
 * closest ranks (Hyndman-Fan type 7, the same as Excel's `PERCENTILE.INC` and
 * R's default). Direction-aware: for `lower_is_better`, P90 is a low value
 * (the ascending 10th quantile), so P90 is always the "better" end.
 */
export function valueAtPercentile(
  values: readonly number[],
  percentile: number,
  direction: MetricDirection,
): number {
  assertPercentile(percentile);
  assertNonEmpty(values, 'valueAtPercentile');
  for (const v of values) assertFinite(v, 'values[]');
  return quantileOfSorted(
    [...values].sort((a, b) => a - b),
    percentile,
    direction,
  );
}

/** Percentiles summarised for chart bands and tables. */
export const SUMMARY_PERCENTILES = [10, 25, 50, 75, 90] as const;
export type SummaryPercentile = (typeof SUMMARY_PERCENTILES)[number];

export interface DistributionSummary {
  readonly sampleSize: number;
  /** Arithmetic mean, in the metric's unit (the "category average" line). */
  readonly mean: number;
  /** Smallest and largest raw values (not direction-aware). */
  readonly min: number;
  readonly max: number;
  /** Values at P10…P90, direction-aware (`p90` is always the "better" end). */
  readonly p10: number;
  readonly p25: number;
  readonly p50: number;
  readonly p75: number;
  readonly p90: number;
}

/** Summary of a non-empty group of values. Exposes no player identities. */
export function summarizeDistribution(
  values: readonly number[],
  direction: MetricDirection,
): DistributionSummary {
  assertNonEmpty(values, 'summarizeDistribution');
  for (const v of values) assertFinite(v, 'values[]');
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: SummaryPercentile): number => quantileOfSorted(sorted, p, direction);
  return {
    sampleSize: sorted.length,
    mean: sorted.reduce((sum, v) => sum + v, 0) / sorted.length,
    min: elementAt(sorted, 0),
    max: elementAt(sorted, sorted.length - 1),
    p10: at(10),
    p25: at(25),
    p50: at(50),
    p75: at(75),
    p90: at(90),
  };
}

function quantileOfSorted(
  sortedAscending: readonly number[],
  percentile: number,
  direction: MetricDirection,
): number {
  const fraction = direction === 'lower_is_better' ? 1 - percentile / 100 : percentile / 100;
  const position = fraction * (sortedAscending.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lowerValue = elementAt(sortedAscending, lowerIndex);
  const upperValue = elementAt(sortedAscending, upperIndex);
  return lowerValue + (upperValue - lowerValue) * (position - lowerIndex);
}

/** Indexed read for indices already known to be in range. */
function elementAt(values: readonly number[], index: number): number {
  const value = values[index];
  if (value === undefined) throw new RangeError(`Index ${String(index)} out of range.`);
  return value;
}

function assertNonEmpty(values: readonly number[], fn: string): void {
  if (values.length === 0) {
    throw new DomainValidationError(
      'invalid_argument',
      `${fn} needs at least one value in the group.`,
      values,
    );
  }
}

function assertPercentile(percentile: number): void {
  if (typeof percentile !== 'number' || !(percentile >= 0 && percentile <= 100)) {
    throw new DomainValidationError(
      'invalid_argument',
      `percentile must be between 0 and 100, got ${describeValue(percentile)}.`,
      percentile,
    );
  }
}

/** @internal */
export function assertFinite(value: number, name: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DomainValidationError(
      'invalid_argument',
      `${name} must be a finite number, got ${describeValue(value)}.`,
      value,
    );
  }
}

/** @internal */
export function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new DomainValidationError(
      'invalid_argument',
      `${name} must be a positive integer, got ${describeValue(value)}.`,
      value,
    );
  }
}
