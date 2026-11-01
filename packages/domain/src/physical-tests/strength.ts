import { aggregateAttempts, type AttemptAggregate } from './attempts.js';
import {
  assertIntegerAtLeast,
  assertNonNegative,
  assertPositive,
  invalidArgument,
} from './validate.js';

/** One submaximal set used to estimate the 1RM. */
export interface StrengthSet {
  /**
   * Total load moved, in kg. For bodyweight exercises (pull-ups) it is body
   * mass plus the added load; the caller adds them.
   */
  readonly loadKg: number;
  /** Repetitions completed with good technique (integer >= 1). */
  readonly reps: number;
  /** Repetitions in reserve reported at the end of the set (>= 0). */
  readonly rir: number;
}

/**
 * Estimated 1RM, Epley with repetitions in reserve (CLAUDE.md, "Protocolos"):
 * `e1RM = load × (1 + (reps + RIR) / 30)`, in kg. The reps the athlete could
 * still do count as done, so a set far from failure is not underestimated.
 * The formula is applied as written also for 1 rep (it gives 1.033 × load).
 */
export function epleyE1rmKg({ loadKg, reps, rir }: StrengthSet): number {
  assertStrengthSet({ loadKg, reps, rir });
  return loadKg * (1 + (reps + rir) / 30);
}

function assertStrengthSet({ loadKg, reps, rir }: StrengthSet): void {
  assertPositive('loadKg', loadKg);
  assertIntegerAtLeast('reps', reps, 1);
  assertNonNegative('rir', rir);
}

/** Protocol limits for sets used to estimate the 1RM. */
export interface E1rmProtocol {
  readonly minReps: number;
  readonly maxReps: number;
  /** Minimum repetitions in reserve: the set is never taken to failure. */
  readonly minRir: number;
}

/**
 * Default e1RM protocol of the `development` stage (M15/M16): 3–5 reps with
 * RIR >= 2, never to failure (CLAUDE.md, "Etapas"). Data, ready to be seeded
 * and overridden per club.
 */
export const DEFAULT_E1RM_PROTOCOL = {
  minReps: 3,
  maxReps: 5,
  minRir: 2,
} as const satisfies E1rmProtocol;

export const E1RM_SET_ISSUES = [
  'reps_below_protocol',
  'reps_above_protocol',
  'rir_below_protocol',
] as const;
export type E1rmSetIssue = (typeof E1RM_SET_ISSUES)[number];

/**
 * Where a set departs from the protocol. Advisory: the result is still
 * stored and estimated, the UI warns (and RIR 0, a set to failure, is always
 * flagged by the default protocol). An empty list means the set is valid.
 */
export function e1rmSetIssues(
  set: StrengthSet,
  protocol: E1rmProtocol = DEFAULT_E1RM_PROTOCOL,
): E1rmSetIssue[] {
  assertStrengthSet(set);
  assertE1rmProtocol(protocol);
  const issues: E1rmSetIssue[] = [];
  if (set.reps < protocol.minReps) issues.push('reps_below_protocol');
  if (set.reps > protocol.maxReps) issues.push('reps_above_protocol');
  if (set.rir < protocol.minRir) issues.push('rir_below_protocol');
  return issues;
}

function assertE1rmProtocol({ minReps, maxReps, minRir }: E1rmProtocol): void {
  assertIntegerAtLeast('protocol.minReps', minReps, 1);
  assertIntegerAtLeast('protocol.maxReps', maxReps, 1);
  assertNonNegative('protocol.minRir', minRir);
  if (maxReps < minReps) {
    invalidArgument('E1rmProtocol: maxReps must be >= minReps.', { minReps, maxReps });
  }
}

export interface E1rmScore {
  /** `e1rm_kg`: the best estimate across sets. */
  readonly e1rmKg: AttemptAggregate;
  /** Estimate of each set, in input order, in kg. */
  readonly setE1rmKg: readonly number[];
  /** Protocol issues of each set, in input order. */
  readonly setIssues: readonly (readonly E1rmSetIssue[])[];
}

/**
 * Scores the sets of one exercise: e1RM per set and the best one (`e1rm_kg`
 * is `higher_is_better`). The exercise is an attribute of the result.
 */
export function scoreE1rm(
  sets: readonly StrengthSet[],
  protocol: E1rmProtocol = DEFAULT_E1RM_PROTOCOL,
): E1rmScore {
  const setE1rmKg = sets.map(epleyE1rmKg);
  return {
    e1rmKg: aggregateAttempts(setE1rmKg, { aggregation: 'best', direction: 'higher_is_better' }),
    setE1rmKg,
    setIssues: sets.map((set) => e1rmSetIssues(set, protocol)),
  };
}

/**
 * `relative_strength_kg_kg`: a load (1RM, 3RM or e1RM) divided by body mass,
 * in kg/kg. Use the body mass measured closest to the test.
 */
export function relativeStrengthKgKg({
  loadKg,
  bodyMassKg,
}: {
  readonly loadKg: number;
  readonly bodyMassKg: number;
}): number {
  assertPositive('loadKg', loadKg);
  assertPositive('bodyMassKg', bodyMassKg);
  return loadKg / bodyMassKg;
}
