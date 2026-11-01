import {
  CANONICAL_METRICS,
  type CanonicalMetric,
  type CanonicalMetricCode,
  type MetricDirection,
} from '../codes.js';
import { memberGuard, memberParser } from '../enum.js';
import { assertFinite, invalidArgument } from './validate.js';

/**
 * How the attempts of a test are reduced to the stored value. It is part of
 * the test definition (data, B-306), never decided by the UI:
 *
 * - `best`: the best attempt according to the metric's direction (sprint and
 *   CMJ protocols: "vale el mejor").
 * - `mean`: arithmetic mean of every valid attempt.
 */
export const ATTEMPT_AGGREGATIONS = ['best', 'mean'] as const;
export type AttemptAggregation = (typeof ATTEMPT_AGGREGATIONS)[number];

export const isAttemptAggregation = memberGuard(ATTEMPT_AGGREGATIONS);
export const parseAttemptAggregation = memberParser(
  ATTEMPT_AGGREGATIONS,
  'invalid_argument',
  'attempt aggregation',
);

export interface AttemptAggregationOptions {
  readonly aggregation: AttemptAggregation;
  readonly direction: MetricDirection;
}

export interface AttemptAggregate {
  /** Aggregated value, in the unit of the attempts. */
  readonly value: number;
  readonly aggregation: AttemptAggregation;
  /** Number of attempts that were aggregated. */
  readonly attemptCount: number;
  /**
   * Index (in input order) of the chosen attempt for `best`; on a tie the
   * earliest attempt wins. `null` for `mean`.
   */
  readonly selectedIndex: number | null;
}

/**
 * Reduces the valid attempts of a metric to one value. Attempts that were not
 * done must be filtered out by the caller: every value here counts.
 *
 * @throws DomainValidationError on an empty list, a non-finite value, or
 *   `best` on a metric whose direction is `neutral` (there is no "best").
 */
export function aggregateAttempts(
  values: readonly number[],
  { aggregation, direction }: AttemptAggregationOptions,
): AttemptAggregate {
  if (values.length === 0) {
    invalidArgument('aggregateAttempts: at least one attempt is required.', values);
  }
  values.forEach((value, index) => {
    assertFinite(`attempt ${String(index)}`, value);
  });

  if (aggregation === 'mean') {
    const sum = values.reduce((total, value) => total + value, 0);
    return {
      value: sum / values.length,
      aggregation,
      attemptCount: values.length,
      selectedIndex: null,
    };
  }

  if (direction === 'neutral') {
    invalidArgument(
      'aggregateAttempts: "best" needs a metric with a direction of improvement.',
      direction,
    );
  }
  const sign = direction === 'higher_is_better' ? 1 : -1;
  let selectedIndex = -1;
  let selected = 0;
  values.forEach((candidate, index) => {
    // Strictly better only: on a tie the earliest attempt stays selected.
    if (selectedIndex === -1 || sign * (candidate - selected) > 0) {
      selectedIndex = index;
      selected = candidate;
    }
  });
  return { value: selected, aggregation, attemptCount: values.length, selectedIndex };
}

/** Default scoring of a metric measured by repeated attempts. */
export interface AttemptScoring {
  readonly aggregation: AttemptAggregation;
  /** Attempts the protocol asks for (per side, for bilateral tests). */
  readonly plannedAttempts: number;
}

/**
 * Default scoring of the canonical metrics measured by repeated attempts
 * (CLAUDE.md, "Protocolos": sprint and CMJ, 3 attempts, the best counts; the
 * 505 follows the same rule per side). Data, ready to be seeded into the test
 * definitions (B-306) and overridden per club. Derived metrics follow the
 * attempts they come from: `sprint_vmax_ms` is computed per attempt and then
 * aggregated, `cod505_asymmetry_pct` is computed from the aggregated sides.
 */
export const DEFAULT_ATTEMPT_SCORING = {
  cmj_height_cm: { aggregation: 'best', plannedAttempts: 3 },
  sprint_10_s: { aggregation: 'best', plannedAttempts: 3 },
  sprint_20_s: { aggregation: 'best', plannedAttempts: 3 },
  sprint_40_s: { aggregation: 'best', plannedAttempts: 3 },
  sprint_vmax_ms: { aggregation: 'best', plannedAttempts: 3 },
  cod505_left_s: { aggregation: 'best', plannedAttempts: 3 },
  cod505_right_s: { aggregation: 'best', plannedAttempts: 3 },
} as const satisfies Partial<Readonly<Record<CanonicalMetricCode, AttemptScoring>>>;

export type AttemptScoredMetricCode = keyof typeof DEFAULT_ATTEMPT_SCORING;

/**
 * {@link aggregateAttempts} for a canonical metric: the direction comes from
 * {@link CANONICAL_METRICS} and the aggregation defaults to
 * {@link DEFAULT_ATTEMPT_SCORING}.
 */
export function aggregateCanonicalMetricAttempts(
  code: AttemptScoredMetricCode,
  values: readonly number[],
  aggregation: AttemptAggregation = DEFAULT_ATTEMPT_SCORING[code].aggregation,
): AttemptAggregate {
  const metric: CanonicalMetric = CANONICAL_METRICS[code];
  return aggregateAttempts(values, { aggregation, direction: metric.direction });
}
