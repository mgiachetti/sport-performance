import { kmhToMs } from '../units.js';
import { assertIntegerAtLeast, assertPositive } from './validate.js';

/** Speed progression of the 30-15 Intermittent Fitness Test. */
export interface Ift3015Protocol {
  /** Running speed of stage 1, in km/h. */
  readonly initialSpeedKmh: number;
  /** Speed added at each new stage, in km/h. */
  readonly stageIncrementKmh: number;
  /** Stage length (30 s running + 15 s recovery), in seconds. Informative. */
  readonly stageDurationS: number;
}

/**
 * Standard 30-15 IFT (Buchheit 2008): 8 km/h at stage 1, +0.5 km/h every
 * 45 s stage. Data, ready to be seeded with the test definition (B-306); a
 * club whose senior squad uses another progression overrides it.
 */
export const DEFAULT_IFT_3015_PROTOCOL = {
  initialSpeedKmh: 8,
  stageIncrementKmh: 0.5,
  stageDurationS: 45,
} as const satisfies Ift3015Protocol;

/**
 * `vift_kmh`: the speed of the last stage completed, in km/h. Stage 1 is the
 * first stage (`initialSpeedKmh`).
 *
 * @param lastCompletedStage 1-based number of the last stage the player
 *   completed (reached the line in time).
 */
export function vift3015Kmh(
  lastCompletedStage: number,
  protocol: Ift3015Protocol = DEFAULT_IFT_3015_PROTOCOL,
): number {
  assertIntegerAtLeast('lastCompletedStage', lastCompletedStage, 1);
  assertPositive('protocol.initialSpeedKmh', protocol.initialSpeedKmh);
  assertPositive('protocol.stageIncrementKmh', protocol.stageIncrementKmh);
  assertPositive('protocol.stageDurationS', protocol.stageDurationS);
  return protocol.initialSpeedKmh + (lastCompletedStage - 1) * protocol.stageIncrementKmh;
}

export interface IntermittentRunInput {
  /** Player's VIFT, in km/h. */
  readonly viftKmh: number;
  /** Target intensity as % of VIFT (e.g. 90). */
  readonly intensityPct: number;
  /** Duration of each run, in seconds (e.g. 15 for 15-15 runs). */
  readonly workDurationS: number;
}

/**
 * Distance to cover in each run of an intermittent drill prescribed from the
 * VIFT (Buchheit 2008): `VIFT (m/s) × intensity / 100 × duration`, in metres.
 * Straight-line runs; shuttle runs need the club's change-of-direction
 * allowance on top.
 */
export function intermittentRunDistanceM({
  viftKmh,
  intensityPct,
  workDurationS,
}: IntermittentRunInput): number {
  assertPositive('viftKmh', viftKmh);
  assertPositive('intensityPct', intensityPct);
  assertPositive('workDurationS', workDurationS);
  return (kmhToMs(viftKmh) * intensityPct * workDurationS) / 100;
}
