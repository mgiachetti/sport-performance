import { CMJ_VIDEO_PREFERRED_FPS, chooseCmjVideoFrameRate } from '@sport-performance/domain';

/** A recording stops alone after this: a jump with its countermovement takes 2–3 s. */
export const CMJ_VIDEO_MAX_DURATION_S = 8;

/**
 * The frame rate to film a CMJ at with a camera that offers these ranges:
 * the preferred one (240 fps) when a range holds it, else the closest that
 * reaches the minimum (`chooseCmjVideoFrameRate`); `null` when the camera
 * cannot film a CMJ.
 */
export function cmjCameraFrameRate(
  ranges: readonly { readonly min: number; readonly max: number }[],
): number | null {
  const candidates = ranges.map((range) =>
    range.min <= CMJ_VIDEO_PREFERRED_FPS && CMJ_VIDEO_PREFERRED_FPS <= range.max
      ? CMJ_VIDEO_PREFERRED_FPS
      : range.max,
  );
  return chooseCmjVideoFrameRate(candidates);
}
