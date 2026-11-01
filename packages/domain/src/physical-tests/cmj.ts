import { STANDARD_GRAVITY_MS2, mToCm } from '../units.js';
import {
  DEFAULT_ATTEMPT_SCORING,
  aggregateCanonicalMetricAttempts,
  type AttemptAggregate,
  type AttemptAggregation,
} from './attempts.js';
import { assertIntegerAtLeast, assertPositive, invalidArgument } from './validate.js';

/**
 * Countermovement jump height from flight time: `h = g·t² / 8` (CLAUDE.md,
 * "Protocolos"; Bosco et al. 1983). Assumes take-off and landing in the same
 * posture (hands on hips, legs extended).
 *
 * @param flightTimeS Time in the air, in seconds.
 * @param gravityMs2 Gravitational acceleration; defaults to 9.81 m/s².
 * @returns Jump height in centimetres.
 */
export function cmjHeightCmFromFlightTimeS(
  flightTimeS: number,
  gravityMs2: number = STANDARD_GRAVITY_MS2,
): number {
  assertPositive('flightTimeS', flightTimeS);
  assertPositive('gravityMs2', gravityMs2);
  return mToCm((gravityMs2 * flightTimeS * flightTimeS) / 8);
}

export interface VideoFlightFrames {
  /** First frame with both feet off the ground. */
  readonly takeoffFrame: number;
  /** First frame with a foot back on the ground. */
  readonly landingFrame: number;
  /** Recording frame rate (frames per second), e.g. 240 for slow motion. */
  readonly frameRateFps: number;
}

/**
 * Flight time from the take-off and landing frames marked on a video (CMJ by
 * video, B-604): `(landingFrame − takeoffFrame) / fps`. The resolution is one
 * frame (≈ 4 ms at 240 fps).
 */
export function flightTimeSFromFrames({
  takeoffFrame,
  landingFrame,
  frameRateFps,
}: VideoFlightFrames): number {
  assertIntegerAtLeast('takeoffFrame', takeoffFrame, 0);
  assertIntegerAtLeast('landingFrame', landingFrame, 0);
  assertPositive('frameRateFps', frameRateFps);
  if (landingFrame <= takeoffFrame) {
    invalidArgument('flightTimeSFromFrames: landingFrame must be after takeoffFrame.', {
      takeoffFrame,
      landingFrame,
    });
  }
  return (landingFrame - takeoffFrame) / frameRateFps;
}

export interface CmjScoreInput {
  /** Flight time of every valid attempt, in seconds. */
  readonly flightTimesS: readonly number[];
  /** Defaults to the `cmj_height_cm` definition: best of 3. */
  readonly aggregation?: AttemptAggregation;
  readonly gravityMs2?: number;
}

export interface CmjScore {
  /** Height of each attempt, in input order, in cm. */
  readonly attemptHeightsCm: readonly number[];
  /** `cmj_height_cm`: the aggregated height. */
  readonly heightCm: AttemptAggregate;
}

/** Scores a CMJ test: height per attempt and the stored `cmj_height_cm`. */
export function scoreCmj({
  flightTimesS,
  aggregation = DEFAULT_ATTEMPT_SCORING.cmj_height_cm.aggregation,
  gravityMs2 = STANDARD_GRAVITY_MS2,
}: CmjScoreInput): CmjScore {
  const attemptHeightsCm = flightTimesS.map((flightTimeS) =>
    cmjHeightCmFromFlightTimeS(flightTimeS, gravityMs2),
  );
  return {
    attemptHeightsCm,
    heightCm: aggregateCanonicalMetricAttempts('cmj_height_cm', attemptHeightsCm, aggregation),
  };
}
