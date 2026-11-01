import { isMetricCode, type MetricCode } from '../codes.js';
import { DomainValidationError, describeValue } from '../errors.js';
import { isSex, type Sex } from '../sex.js';

/**
 * Expected range of a metric for an age interval and sex (B-206). It does not
 * tell a good result from a bad one: it catches typing errors at entry time
 * (a 40 m sprint in 3 s, a height of 17 cm) and only produces a warning, never
 * a block.
 *
 * Shaped like a database row so the defaults can be seeded as is (B-306) and
 * overridden per club (B-322).
 */
export interface PlausibleRange {
  readonly metricCode: MetricCode;
  /** Sex the range applies to; `null` applies to both. */
  readonly sex: Sex | null;
  /** Inclusive lower bound of the decimal age, in years; `null` is open. */
  readonly minAgeYears: number | null;
  /** Exclusive upper bound of the decimal age, in years; `null` is open. */
  readonly maxAgeYears: number | null;
  /** Inclusive lower bound, in the unit of the metric code (`sprint_40_s` → s). */
  readonly minValue: number;
  /** Inclusive upper bound, in the unit of the metric code. */
  readonly maxValue: number;
}

/**
 * Checks that every range is well formed and that no two ranges of the same
 * metric and the same sex (or both without sex) overlap in age, so that at
 * most one range applies per level of specificity. Throws a
 * {@link DomainValidationError} with code `invalid_argument` on the first
 * problem found.
 */
export function validatePlausibleRanges(ranges: readonly PlausibleRange[]): void {
  ranges.forEach(assertWellFormedRange);

  const groups = new Map<string, PlausibleRange[]>();
  for (const range of ranges) {
    const key = `${range.metricCode}|${range.sex ?? '*'}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [range]);
    else group.push(range);
  }

  for (const group of groups.values()) {
    const sorted = [...group].sort(
      (a, b) => (a.minAgeYears ?? -Infinity) - (b.minAgeYears ?? -Infinity),
    );
    for (let i = 1; i < sorted.length; i++) {
      const previous = sorted[i - 1];
      const current = sorted[i];
      if (previous === undefined || current === undefined) continue;
      if ((previous.maxAgeYears ?? Infinity) > (current.minAgeYears ?? -Infinity)) {
        throw new DomainValidationError(
          'invalid_argument',
          `Plausible ranges of ${current.metricCode} (sex ${current.sex ?? 'any'}) overlap in age: ` +
            `${describeAgeInterval(previous)} and ${describeAgeInterval(current)}.`,
          { previous, current },
        );
      }
    }
  }
}

/**
 * Applies a club's ranges on top of the defaults: for every metric the club
 * configures, its ranges replace all the default ranges of that metric; the
 * other metrics keep the defaults. The result is validated.
 */
export function mergePlausibleRanges(
  defaults: readonly PlausibleRange[],
  overrides: readonly PlausibleRange[],
): PlausibleRange[] {
  const overridden = new Set<string>(overrides.map((range) => range.metricCode));
  const merged = [...defaults.filter((range) => !overridden.has(range.metricCode)), ...overrides];
  validatePlausibleRanges(merged);
  return merged;
}

function assertWellFormedRange(range: PlausibleRange): void {
  const fail = (reason: string): never => {
    throw new DomainValidationError(
      'invalid_argument',
      `Invalid plausible range for ${describeValue(range.metricCode)}: ${reason}.`,
      range,
    );
  };

  if (!isMetricCode(range.metricCode)) fail('metric code is not well formed');
  if (range.sex !== null && !isSex(range.sex)) fail(`invalid sex ${describeValue(range.sex)}`);
  if (!Number.isFinite(range.minValue) || !Number.isFinite(range.maxValue)) {
    fail('minValue and maxValue must be finite numbers');
  }
  if (range.minValue > range.maxValue) fail('minValue must not exceed maxValue');

  for (const age of [range.minAgeYears, range.maxAgeYears]) {
    if (age !== null && (!Number.isFinite(age) || age < 0)) {
      fail('age bounds must be null or finite non-negative numbers');
    }
  }
  if (
    range.minAgeYears !== null &&
    range.maxAgeYears !== null &&
    range.minAgeYears >= range.maxAgeYears
  ) {
    fail('minAgeYears must be less than maxAgeYears');
  }
}

function describeAgeInterval(range: PlausibleRange): string {
  return `[${String(range.minAgeYears ?? '-∞')}, ${String(range.maxAgeYears ?? '∞')})`;
}
