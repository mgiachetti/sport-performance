import { SPRINT_VIDEO_PREFERRED_FPS, chooseSprintVideoFrameRate } from '@sport-performance/domain';

/**
 * A recording stops alone after this: a 40 m takes 5–8 s from M13 to M19,
 * plus the wait before the start and a margin after the finish.
 */
export const SPRINT_VIDEO_MAX_DURATION_S = 20;

/**
 * Largest recording: 20 s at 1080p and 240 fps is about 250 MB on the
 * phones that film at that rate. Past it the recording stops.
 */
export const SPRINT_VIDEO_MAX_SIZE_BYTES = 400 * 1024 * 1024;

/**
 * The frame rate to film a sprint at with a camera that offers these
 * ranges: the preferred one (240 fps) when a range holds it, else the
 * closest that reaches the minimum (`chooseSprintVideoFrameRate`); `null`
 * when the camera cannot film a sprint.
 */
export function sprintCameraFrameRate(
  ranges: readonly { readonly min: number; readonly max: number }[],
): number | null {
  const candidates = ranges.map((range) =>
    range.min <= SPRINT_VIDEO_PREFERRED_FPS && SPRINT_VIDEO_PREFERRED_FPS <= range.max
      ? SPRINT_VIDEO_PREFERRED_FPS
      : range.max,
  );
  return chooseSprintVideoFrameRate(candidates);
}
