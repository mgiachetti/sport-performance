import {
  aggregateCanonicalMetricAttempts,
  type AttemptAggregate,
  type AttemptAggregation,
} from './attempts.js';
import { assertPositive } from './validate.js';

/** Turning foot of the 505 that was faster; `none` when both times are equal. */
export type Cod505FasterSide = 'left' | 'right' | 'none';

export interface Cod505Times {
  /** Time turning on the left foot, in seconds. */
  readonly leftS: number;
  /** Time turning on the right foot, in seconds. */
  readonly rightS: number;
}

export interface Cod505Asymmetry {
  /** `cod505_asymmetry_pct`: always >= 0. */
  readonly asymmetryPct: number;
  readonly fasterSide: Cod505FasterSide;
}

/**
 * Left/right asymmetry of the 505, as a percentage of the faster side:
 * `|left − right| / min(left, right) × 100` (the "percentage difference" of
 * Bishop et al. 2018, with the faster time as the better-performing side).
 * The side is reported apart so the magnitude stays comparable.
 */
export function cod505Asymmetry({ leftS, rightS }: Cod505Times): Cod505Asymmetry {
  assertPositive('leftS', leftS);
  assertPositive('rightS', rightS);
  const fasterS = Math.min(leftS, rightS);
  const fasterSide: Cod505FasterSide = leftS < rightS ? 'left' : rightS < leftS ? 'right' : 'none';
  return { asymmetryPct: (Math.abs(leftS - rightS) / fasterS) * 100, fasterSide };
}

/** `cod505_asymmetry_pct` alone. See {@link cod505Asymmetry}. */
export function cod505AsymmetryPct(times: Cod505Times): number {
  return cod505Asymmetry(times).asymmetryPct;
}

export interface Cod505ScoreInput {
  /** Valid attempts turning on the left foot, in seconds. */
  readonly leftAttemptsS: readonly number[];
  /** Valid attempts turning on the right foot, in seconds. */
  readonly rightAttemptsS: readonly number[];
  /** Overrides the aggregation of both sides; defaults to their definition (best). */
  readonly aggregation?: AttemptAggregation;
}

export interface Cod505Score extends Cod505Asymmetry {
  /** `cod505_left_s`. */
  readonly leftS: AttemptAggregate;
  /** `cod505_right_s`. */
  readonly rightS: AttemptAggregate;
}

/**
 * Scores a 505 test: each side is aggregated on its own and the asymmetry is
 * computed from the aggregated times (best left vs best right by default).
 */
export function scoreCod505({
  leftAttemptsS,
  rightAttemptsS,
  aggregation,
}: Cod505ScoreInput): Cod505Score {
  leftAttemptsS.forEach((value, index) => {
    assertPositive(`leftAttemptsS[${String(index)}]`, value);
  });
  rightAttemptsS.forEach((value, index) => {
    assertPositive(`rightAttemptsS[${String(index)}]`, value);
  });
  const leftS = aggregateCanonicalMetricAttempts('cod505_left_s', leftAttemptsS, aggregation);
  const rightS = aggregateCanonicalMetricAttempts('cod505_right_s', rightAttemptsS, aggregation);
  return { leftS, rightS, ...cod505Asymmetry({ leftS: leftS.value, rightS: rightS.value }) };
}
