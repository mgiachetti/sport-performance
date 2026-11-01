import {
  aggregateCanonicalMetricAttempts,
  type AttemptAggregate,
  type AttemptAggregation,
} from './attempts.js';
import { assertPositive, invalidArgument } from './validate.js';

/**
 * Average speed over a segment between two timing gates:
 * `distanceM / (endTimeS − startTimeS)`, in m/s.
 *
 * @throws DomainValidationError when the distance is not positive or the end
 *   time is not after the start time.
 */
export function segmentSpeedMs(distanceM: number, startTimeS: number, endTimeS: number): number {
  assertPositive('distanceM', distanceM);
  if (!Number.isFinite(startTimeS) || startTimeS < 0) {
    invalidArgument('segmentSpeedMs: startTimeS must be a finite number >= 0.', startTimeS);
  }
  assertPositive('endTimeS', endTimeS);
  if (endTimeS <= startTimeS) {
    invalidArgument('segmentSpeedMs: endTimeS must be after startTimeS.', {
      startTimeS,
      endTimeS,
    });
  }
  return distanceM / (endTimeS - startTimeS);
}

/** Gates (distance from the start line, in m) of the segment used for Vmax. */
export interface SprintVmaxSegment {
  readonly fromM: number;
  readonly toM: number;
}

/**
 * Vmax segment of the `sprint_40` test: 20–40 m, so `vmax = 20 / (t40 − t20)`
 * (CLAUDE.md, "Batería de tests"). Part of the definition of the canonical
 * `sprint_vmax_ms`, so it is fixed: a club using other gates defines its own
 * metric and calls {@link segmentSpeedMs}.
 */
export const SPRINT_VMAX_SEGMENT = {
  fromM: 20,
  toM: 40,
} as const satisfies SprintVmaxSegment;

/** Split times of one `sprint_40` attempt, in seconds from the start. */
export interface Sprint40Splits {
  /** 10 m split; optional because some setups only have gates at 20 and 40 m. */
  readonly split10S?: number;
  readonly split20S: number;
  readonly split40S: number;
}

/**
 * Validates one attempt: every split is positive and they strictly increase
 * with distance (`t10 < t20 < t40`).
 */
export function assertSprint40Splits({ split10S, split20S, split40S }: Sprint40Splits): void {
  if (split10S !== undefined) assertPositive('split10S', split10S);
  assertPositive('split20S', split20S);
  assertPositive('split40S', split40S);
  if ((split10S !== undefined && split10S >= split20S) || split20S >= split40S) {
    invalidArgument('Sprint splits must strictly increase with distance (t10 < t20 < t40).', {
      split10S,
      split20S,
      split40S,
    });
  }
}

/**
 * `sprint_vmax_ms` of one attempt: average speed over the 20–40 m segment,
 * `20 / (t40 − t20)`, in m/s.
 */
export function sprintVmaxMs(splits: Sprint40Splits): number {
  assertSprint40Splits(splits);
  const { fromM, toM } = SPRINT_VMAX_SEGMENT;
  return segmentSpeedMs(toM - fromM, splits.split20S, splits.split40S);
}

export interface Sprint40ScoreOptions {
  /**
   * Overrides the aggregation of every metric of the test; omitted, each
   * metric uses its definition (best of 3).
   */
  readonly aggregation?: AttemptAggregation;
}

export interface Sprint40Score {
  /** `sprint_10_s`; `null` when no attempt has a 10 m split. */
  readonly split10S: AttemptAggregate | null;
  /** `sprint_20_s`. */
  readonly split20S: AttemptAggregate;
  /** `sprint_40_s`. */
  readonly split40S: AttemptAggregate;
  /** `sprint_vmax_ms`, aggregated from the Vmax of each attempt. */
  readonly vmaxMs: AttemptAggregate;
  /** Vmax of each attempt, in input order, in m/s. */
  readonly attemptVmaxMs: readonly number[];
}

/**
 * Scores a `sprint_40` test. Each metric is aggregated on its own across
 * attempts (best split at each gate, best Vmax), as the protocol says "vale el
 * mejor" for each stored value; Vmax is computed per attempt first, never from
 * splits of different attempts. `selectedIndex` of each aggregate is the index
 * of the attempt it came from, in input order.
 */
export function scoreSprint40(
  attempts: readonly Sprint40Splits[],
  { aggregation }: Sprint40ScoreOptions = {},
): Sprint40Score {
  if (attempts.length === 0) {
    invalidArgument('scoreSprint40: at least one attempt is required.', attempts);
  }
  const attemptVmaxMs = attempts.map(sprintVmaxMs);
  return {
    split10S: aggregateSplit10S(attempts, aggregation),
    split20S: aggregateCanonicalMetricAttempts(
      'sprint_20_s',
      attempts.map(({ split20S }) => split20S),
      aggregation,
    ),
    split40S: aggregateCanonicalMetricAttempts(
      'sprint_40_s',
      attempts.map(({ split40S }) => split40S),
      aggregation,
    ),
    vmaxMs: aggregateCanonicalMetricAttempts('sprint_vmax_ms', attemptVmaxMs, aggregation),
    attemptVmaxMs,
  };
}

/** Aggregates the 10 m splits of the attempts that have one, keeping input indexes. */
function aggregateSplit10S(
  attempts: readonly Sprint40Splits[],
  aggregation: AttemptAggregation | undefined,
): AttemptAggregate | null {
  const indexes: number[] = [];
  const values: number[] = [];
  attempts.forEach(({ split10S }, index) => {
    if (split10S === undefined) return;
    indexes.push(index);
    values.push(split10S);
  });
  if (values.length === 0) return null;
  const aggregate = aggregateCanonicalMetricAttempts('sprint_10_s', values, aggregation);
  return {
    ...aggregate,
    selectedIndex:
      aggregate.selectedIndex === null ? null : (indexes[aggregate.selectedIndex] ?? null),
  };
}
