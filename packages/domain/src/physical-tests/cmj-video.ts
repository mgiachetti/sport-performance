import { STANDARD_GRAVITY_MS2 } from '../units.js';
import {
  cmjHeightCmFromFlightTimeS,
  flightTimeSFromFrames,
  type VideoFlightFrames,
} from './cmj.js';
import { assertIntegerAtLeast, assertPositive } from './validate.js';

/**
 * CMJ by video (B-604, ADR 0085): the phone films the jump at high speed and
 * the evaluator marks, frame by frame, the first frame in the air and the
 * first frame back on the ground. The flight time is the number of frames
 * between them over the frame rate; the height, `h = g·t²/8`.
 */

/**
 * Lowest frame rate a CMJ is filmed at. One frame is the resolution of the
 * flight time: at 120 fps (8,3 ms) a 40 cm jump is ±1,2 cm, at 30 fps ±4,6 cm,
 * which is more than the change the test looks for.
 */
export const CMJ_VIDEO_MIN_FPS = 120;

/** Frame rate asked for when the camera has it (slow motion): ±0,6 cm at 240 fps. */
export const CMJ_VIDEO_PREFERRED_FPS = 240;

/**
 * Time of a frame for asking the player (or the frame extractor) for its
 * image: the middle of the frame, so a rounding of the time in either
 * direction still lands in it.
 *
 * @returns Milliseconds from the start of the video.
 */
export function videoFrameTimeMs(frame: number, frameRateFps: number): number {
  assertIntegerAtLeast('frame', frame, 0);
  assertPositive('frameRateFps', frameRateFps);
  return ((frame + 0.5) * 1000) / frameRateFps;
}

/** Frames of a video of `durationMs` at `frameRateFps` (the last one may be partial: left out). */
export function videoFrameCount(durationMs: number, frameRateFps: number): number {
  assertPositive('durationMs', durationMs);
  assertPositive('frameRateFps', frameRateFps);
  return Math.max(1, Math.floor((durationMs * frameRateFps) / 1000));
}

/** `frame` moved by `delta` frames, kept within the video (`0` to `frameCount − 1`). */
export function stepVideoFrame(frame: number, delta: number, frameCount: number): number {
  assertIntegerAtLeast('frameCount', frameCount, 1);
  return Math.min(frameCount - 1, Math.max(0, Math.round(frame + delta)));
}

export interface CmjVideoMeasurement {
  readonly flightTimeS: number;
  readonly heightCm: number;
  /**
   * How much the height moves when either mark is one frame off (half of
   * `h(t + 1 frame) − h(t − 1 frame)`): the precision of the marking, shown
   * next to the height.
   */
  readonly precisionCm: number;
}

/**
 * Flight time, height and precision of a marked jump, with the gravity of
 * the protocol version (`parameters.gravityMs2`, 9,81 by default). Throws a
 * `DomainValidationError` when the landing is not after the take-off.
 */
export function cmjVideoMeasurement(
  frames: VideoFlightFrames,
  gravityMs2: number = STANDARD_GRAVITY_MS2,
): CmjVideoMeasurement {
  const flightTimeS = flightTimeSFromFrames(frames);
  const heightCm = cmjHeightCmFromFlightTimeS(flightTimeS, gravityMs2);
  const frameS = 1 / frames.frameRateFps;
  const longer = cmjHeightCmFromFlightTimeS(flightTimeS + frameS, gravityMs2);
  const shorter =
    flightTimeS > frameS ? cmjHeightCmFromFlightTimeS(flightTimeS - frameS, gravityMs2) : 0;
  return { flightTimeS, heightCm, precisionCm: (longer - shorter) / 2 };
}

/** Whether the camera's frame rate is enough to film a CMJ ({@link CMJ_VIDEO_MIN_FPS}). */
export function isCmjVideoFrameRate(frameRateFps: number): boolean {
  return Number.isFinite(frameRateFps) && frameRateFps >= CMJ_VIDEO_MIN_FPS;
}

/**
 * The frame rate to film at among what the camera offers: the preferred one
 * if it is there, else the fastest one that reaches the minimum; `null`
 * when none does (the phone cannot film a CMJ).
 */
export function chooseCmjVideoFrameRate(available: readonly number[]): number | null {
  const usable = available.filter(isCmjVideoFrameRate);
  if (usable.length === 0) return null;
  if (usable.includes(CMJ_VIDEO_PREFERRED_FPS)) return CMJ_VIDEO_PREFERRED_FPS;
  const below = usable.filter((fps) => fps < CMJ_VIDEO_PREFERRED_FPS);
  // Closest to the preferred rate: faster than that only costs light and storage.
  return below.length > 0 ? Math.max(...below) : Math.min(...usable);
}
