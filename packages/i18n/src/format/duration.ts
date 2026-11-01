import { PLACEHOLDER } from './number.js';

/**
 * Formats a duration in seconds as a clock: `m:ss` below one hour, `h:mm:ss` from one hour.
 * Rounds to the nearest second (`274.6` → `4:35`). Negative durations get a leading `-`.
 * Missing or non-finite values render as {@link PLACEHOLDER}.
 *
 * Use `formatUnit(value, 's')` instead for short timed efforts such as sprints (`1,85 s`).
 */
export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(totalSeconds))
    return PLACEHOLDER;

  const rounded = Math.round(Math.abs(totalSeconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;
  const ss = String(seconds).padStart(2, '0');
  const clock =
    hours > 0
      ? `${String(hours)}:${String(minutes).padStart(2, '0')}:${ss}`
      : `${String(minutes)}:${ss}`;
  return totalSeconds < 0 && rounded > 0 ? `-${clock}` : clock;
}
